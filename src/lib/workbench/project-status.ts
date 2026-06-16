import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { resolveSmallProjectPaths } from "../project-core/paths.ts";

export type WorkbenchProjectMode = "image_music_mode" | "source_video_mode" | "v5_control_plane" | "blocked" | "conflict";
export type WorkbenchStepStatus =
  | "not_started"
  | "input_required"
  | "input_uploaded"
  | "input_confirmed"
  | "queued"
  | "ready"
  | "running"
  | "stopping"
  | "stopped"
  | "passed"
  | "blocked"
  | "failed"
  | "diagnostic_only";

export type WorkbenchBlockingReason = {
  code: string;
  message: string;
};

export type WorkbenchFileRef = {
  exists: boolean;
  path?: string;
  sha256?: string;
};

export type WorkbenchArtifact = WorkbenchFileRef & {
  id: string;
};

export type WorkbenchStep = {
  id: string;
  label: string;
  status: WorkbenchStepStatus;
  artifacts: WorkbenchArtifact[];
};

export type WorkbenchAgentRunSummary = WorkbenchFileRef & {
  id: string;
  mode?: string;
  operation?: string;
  status?: WorkbenchStepStatus;
  exit_code?: number | null;
  timed_out?: boolean;
};

export type WorkbenchProjectStatus = {
  schema_version: 1;
  small_project_id: string;
  mode: WorkbenchProjectMode;
  primary_ratio: string | null;
  overall_status: WorkbenchStepStatus;
  blocking_reasons: WorkbenchBlockingReason[];
  inputs: {
    active_music_take: WorkbenchFileRef;
    lyrics: WorkbenchFileRef;
    animation_plan: WorkbenchFileRef & { approved: boolean };
    image_generation_plan: WorkbenchFileRef;
    source_video: WorkbenchFileRef;
  };
  steps: WorkbenchStep[];
  artifacts: WorkbenchArtifact[];
  agent_runs: WorkbenchAgentRunSummary[];
  export: {
    final_mp4: WorkbenchFileRef;
  };
};

type FileCandidate = {
  id?: string;
  paths: string[];
};

type OptionalJson = Record<string, unknown> | null;

export async function readWorkbenchProjectStatus(input: {
  storageRoot: string;
  smallProjectId: string;
}): Promise<WorkbenchProjectStatus> {
  const paths = resolveSmallProjectPaths(input.storageRoot, input.smallProjectId);
  const projectRoot = paths.projectRoot;

  const activeMusicTake = await firstExisting(projectRoot, [
    "active_music_take.mp3",
    "audio/master/active_music_take.mp3",
    "active_music_take.wav",
    "audio/master/active_music_take.wav",
  ]);
  const lyrics = await firstExisting(projectRoot, ["lyrics.md", "timing/lyrics.md"]);
  const animationPlan = await firstExisting(projectRoot, ["animation_plan.json", "qivance/animation_plan.json"]);
  const imageGenerationPlan = await firstExisting(projectRoot, ["image_generation_plan.json", "qivance/image_generation_plan.json"]);
  const imageAssets = await firstExisting(projectRoot, ["data/storyboard/image_assets.json", "assets/image_assets.json"]);
  const sourceVideo = await firstExisting(projectRoot, ["source_video.mp4", "data/source/source_video.mp4"]);
  const sourceVideoImport = await firstExisting(projectRoot, ["data/source/source_video_import.json"]);
  const workflowCheckpoints = await readOptionalJson(path.join(projectRoot, "workflow_checkpoints.json"));
  const projectStatusCache = await readOptionalJson(path.join(projectRoot, "project_status.json"));
  const approved = animationPlan.exists && isAnimationPlanApproved(workflowCheckpoints, projectStatusCache);
  const mode = detectMode({
    activeMusicTake,
    imageGenerationPlan,
    imageAssets,
    sourceVideo,
    sourceVideoImport,
    workflowCheckpoints,
    projectStatusCache,
  });
  const artifacts = await collectArtifacts(projectRoot, input.smallProjectId);
  const artifactMap = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const agentRuns = await collectAgentRuns(projectRoot, input.smallProjectId);
  const primaryRatio = await readPrimaryRatio(projectRoot, animationPlan, artifactMap.get("render_manifest"), input.smallProjectId);
  const blockingReasons = buildBlockingReasons({
    mode,
    activeMusicTake,
    lyrics,
    animationPlan,
    imageGenerationPlan,
    imageAssets,
    sourceVideo,
    sourceVideoImport,
    approved,
  });
  const steps = buildSteps({
    mode,
    approved,
    artifacts,
    artifactMap,
    agentRuns,
    blockingReasons,
  });

  return {
    schema_version: 1,
    small_project_id: input.smallProjectId,
    mode,
    primary_ratio: primaryRatio,
    overall_status: overallStatus(steps, blockingReasons),
    blocking_reasons: blockingReasons,
    inputs: {
      active_music_take: activeMusicTake,
      lyrics,
      animation_plan: { ...animationPlan, approved },
      image_generation_plan: imageGenerationPlan,
      source_video: sourceVideo.exists ? sourceVideo : sourceVideoImport,
    },
    steps,
    artifacts,
    agent_runs: agentRuns,
    export: {
      final_mp4: artifactMap.get("final_mp4") ?? await firstExisting(projectRoot, ["exports/final.mp4"]),
    },
  };
}

function detectMode(input: {
  activeMusicTake: WorkbenchFileRef;
  imageGenerationPlan: WorkbenchFileRef;
  imageAssets: WorkbenchFileRef;
  sourceVideo: WorkbenchFileRef;
  sourceVideoImport: WorkbenchFileRef;
  workflowCheckpoints: OptionalJson;
  projectStatusCache: OptionalJson;
}): WorkbenchProjectMode {
  const explicitMode = modeValue(input.projectStatusCache?.mode) ?? modeValue(input.workflowCheckpoints?.mode);
  const sourceVideoMode = input.sourceVideo.exists || input.sourceVideoImport.exists;
  const imageMusicMode = input.activeMusicTake.exists && (input.imageGenerationPlan.exists || input.imageAssets.exists);

  if (sourceVideoMode && imageMusicMode) return explicitMode ?? "conflict";
  if (sourceVideoMode) return "source_video_mode";
  if (imageMusicMode) return "image_music_mode";
  return "blocked";
}

function buildBlockingReasons(input: {
  mode: WorkbenchProjectMode;
  activeMusicTake: WorkbenchFileRef;
  lyrics: WorkbenchFileRef;
  animationPlan: WorkbenchFileRef;
  imageGenerationPlan: WorkbenchFileRef;
  imageAssets: WorkbenchFileRef;
  sourceVideo: WorkbenchFileRef;
  sourceVideoImport: WorkbenchFileRef;
  approved: boolean;
}): WorkbenchBlockingReason[] {
  const reasons: WorkbenchBlockingReason[] = [];
  if (input.mode === "conflict") {
    reasons.push({
      code: "mode_conflict",
      message: "Project has both image/music and source video inputs; choose a mode before production actions.",
    });
  }
  if (input.mode === "blocked") {
    reasons.push({
      code: "no_supported_input_mode",
      message: "Project must contain image/music inputs or source video inputs.",
    });
  }
  if (!input.animationPlan.exists) {
    reasons.push({
      code: "animation_plan_missing",
      message: "Animation Plan is required before Workbench production actions.",
    });
  } else if (!input.approved) {
    reasons.push({
      code: "animation_plan_unapproved",
      message: "Animation Plan must be approved before image generation or agent production.",
    });
  }
  if (input.mode === "image_music_mode" && !input.lyrics.exists) {
    reasons.push({
      code: "lyrics_missing",
      message: "lyrics.md is required for image/music projects.",
    });
  }
  if (input.activeMusicTake.exists && !input.imageGenerationPlan.exists && !input.imageAssets.exists) {
    reasons.push({
      code: "image_generation_plan_missing",
      message: "image_generation_plan.json is required unless locked V2 image assets already exist.",
    });
  }
  if (input.mode === "source_video_mode" && !input.sourceVideo.exists && !input.sourceVideoImport.exists) {
    reasons.push({
      code: "source_video_missing",
      message: "source_video.mp4 or data/source/source_video_import.json is required for source video mode.",
    });
  }
  return reasons;
}

function buildSteps(input: {
  mode: WorkbenchProjectMode;
  approved: boolean;
  artifacts: WorkbenchArtifact[];
  artifactMap: Map<string, WorkbenchArtifact>;
  agentRuns: WorkbenchAgentRunSummary[];
  blockingReasons: WorkbenchBlockingReason[];
}): WorkbenchStep[] {
  const artifact = (...ids: string[]) => ids.flatMap((id) => {
    const value = input.artifactMap.get(id);
    return value ? [value] : [];
  });
  const has = (id: string) => Boolean(input.artifactMap.get(id)?.exists);
  const timingPassed = ["beat_grid", "onset_events", "energy_curve", "section_map"].every(has);
  const previewPassed = has("project_json") && has("frame_contracts") && has("content_graph") && has("agent_context");
  const agentStatus = htmlVideoAgentStatus(input.agentRuns, previewPassed);
  const scheduleStatus = fileStatus(input.artifactMap.get("image_generation_schedule"), "ready");
  const promptStatus = fileStatus(input.artifactMap.get("image_prompt_group"), "ready");
  const sourceMode = input.mode === "source_video_mode";

  return [
    {
      id: "validate_input",
      label: "Validate input",
      status: input.mode === "blocked" || input.mode === "conflict" ? "blocked" : "passed",
      artifacts: [],
    },
    {
      id: "animation_plan",
      label: "Animation Plan",
      status: has("animation_plan") ? (input.approved ? "passed" : "blocked") : "blocked",
      artifacts: artifact("animation_plan"),
    },
    {
      id: "timing",
      label: "Timing",
      status: sourceMode ? "not_started" : timingPassed ? "passed" : has("lyrics") ? "ready" : "blocked",
      artifacts: artifact("lyrics", "beat_grid", "onset_events", "energy_curve", "lyric_word_timing", "alignment_report", "section_map"),
    },
    {
      id: "image_schedule",
      label: "Image schedule",
      status: sourceMode ? "not_started" : has("image_generation_schedule") ? scheduleStatus : has("section_map") && input.approved ? "ready" : "blocked",
      artifacts: artifact("section_map", "image_generation_schedule"),
    },
    {
      id: "image_prompt_group",
      label: "Image prompt group",
      status: sourceMode ? "not_started" : has("image_prompt_group") ? promptStatus : has("image_generation_schedule") ? "ready" : "not_started",
      artifacts: artifact("image_prompt_group"),
    },
    {
      id: "image_review",
      label: "Image review",
      status: sourceMode ? "not_started" : has("image_assets") ? "passed" : has("image_prompt_group") ? "ready" : "not_started",
      artifacts: artifact("image_assets", "image_review_decisions"),
    },
    {
      id: "html_video_agent",
      label: "html-video agent",
      status: agentStatus,
      artifacts: artifact("project_json", "content_graph", "frame_contracts", "agent_context"),
    },
    {
      id: "preview",
      label: "Preview",
      status: previewPassed ? "passed" : agentStatus === "passed" || agentStatus === "diagnostic_only" ? "ready" : "not_started",
      artifacts: artifact("project_json", "frame_contracts"),
    },
    {
      id: "revision",
      label: "Revision",
      status: revisionStatus(input.artifactMap.get("revision_request"), previewPassed),
      artifacts: artifact("revision_request"),
    },
    {
      id: "render",
      label: "Render",
      status: has("visual_silent_mp4") ? "passed" : previewPassed ? "ready" : "not_started",
      artifacts: artifact("visual_silent_mp4"),
    },
    {
      id: "export",
      label: "Export",
      status: has("final_mp4") ? "passed" : has("visual_silent_mp4") ? "ready" : "not_started",
      artifacts: artifact("render_manifest", "final_mp4"),
    },
  ];
}

function overallStatus(steps: WorkbenchStep[], blockingReasons: WorkbenchBlockingReason[]): WorkbenchStepStatus {
  if (steps.some((step) => step.status === "failed")) return "failed";
  if (blockingReasons.length > 0 || steps.some((step) => step.status === "blocked")) return "blocked";
  if (steps.some((step) => step.status === "diagnostic_only")) return "diagnostic_only";
  if (steps.find((step) => step.id === "export")?.status === "passed") return "passed";
  if (steps.some((step) => step.status === "ready")) return "ready";
  return "not_started";
}

async function collectArtifacts(projectRoot: string, smallProjectId: string): Promise<WorkbenchArtifact[]> {
  const htmlProjectRoot = `video/html-video/.html-video/projects/${smallProjectId}`;
  const candidates: Array<FileCandidate & { id: string }> = [
    { id: "active_music_take", paths: ["active_music_take.mp3", "audio/master/active_music_take.mp3", "active_music_take.wav", "audio/master/active_music_take.wav"] },
    { id: "lyrics", paths: ["lyrics.md", "timing/lyrics.md"] },
    { id: "animation_plan", paths: ["animation_plan.json", "qivance/animation_plan.json"] },
    { id: "image_generation_plan", paths: ["image_generation_plan.json", "qivance/image_generation_plan.json"] },
    { id: "beat_grid", paths: ["data/timing/beat_grid.json", "timing/beat_grid.json", "data/audio_analysis/beat_grid.json"] },
    { id: "onset_events", paths: ["data/timing/onset_events.json", "timing/onset_events.json", "data/audio_analysis/onset_events.json"] },
    { id: "energy_curve", paths: ["data/timing/energy_curve.json", "timing/energy_curve.json", "data/audio_analysis/energy_curve.json"] },
    { id: "lyric_word_timing", paths: ["data/timing/lyric_word_timing.json", "timing/lyric_word_timing.json"] },
    { id: "alignment_report", paths: ["data/timing/alignment_report.json", "timing/alignment_report.json"] },
    { id: "section_map", paths: ["data/storyboard/section_map.json", "timing/section_map.json"] },
    { id: "image_generation_schedule", paths: ["data/storyboard/image_generation_schedule.json"] },
    { id: "image_prompt_group", paths: ["data/storyboard/image_prompt_group.json"] },
    { id: "image_assets", paths: ["data/storyboard/image_assets.json", "assets/image_assets.json"] },
    { id: "image_review_decisions", paths: ["data/storyboard/image_review_decisions.json", "assets/image_review_decisions.json"] },
    { id: "source_video", paths: ["source_video.mp4", "data/source/source_video.mp4"] },
    { id: "source_video_import", paths: ["data/source/source_video_import.json"] },
    { id: "project_json", paths: [`${htmlProjectRoot}/project.json`] },
    { id: "content_graph", paths: [`${htmlProjectRoot}/content-graph.json`] },
    { id: "frame_contracts", paths: [`${htmlProjectRoot}/qivance-frame-contracts.json`] },
    { id: "agent_context", paths: [`${htmlProjectRoot}/codex/agent_context.json`] },
    { id: "revision_request", paths: ["revision_request.json"] },
    { id: "visual_silent_mp4", paths: ["exports/visual_silent.mp4", "exports/visual.mp4"] },
    { id: "render_manifest", paths: ["exports/render_manifest.json"] },
    { id: "final_mp4", paths: ["exports/final.mp4"] },
  ];

  return await Promise.all(candidates.map(async (candidate) => ({
    id: candidate.id,
    ...await firstExisting(projectRoot, candidate.paths),
  })));
}

async function collectAgentRuns(projectRoot: string, smallProjectId: string): Promise<WorkbenchAgentRunSummary[]> {
  const htmlProjectRoot = `video/html-video/.html-video/projects/${smallProjectId}`;
  const agentRunDir = path.join(projectRoot, htmlProjectRoot, "agent_runs");
  const runs: WorkbenchAgentRunSummary[] = [];
  try {
    const entries = await readdir(agentRunDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      runs.push(await agentRunSummary(projectRoot, path.join(htmlProjectRoot, "agent_runs", entry.name), path.basename(entry.name, ".json")));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const legacyPath = `${htmlProjectRoot}/codex/html-video-runtime-result.json`;
  const legacy = await firstExisting(projectRoot, [legacyPath]);
  if (legacy.exists) runs.push(await agentRunSummary(projectRoot, legacy.path ?? legacyPath, "html-video-runtime-result"));
  return runs.sort((a, b) => (a.path ?? a.id).localeCompare(b.path ?? b.id));
}

async function agentRunSummary(projectRoot: string, relativePath: string, id: string): Promise<WorkbenchAgentRunSummary> {
  const ref = await firstExisting(projectRoot, [relativePath]);
  const json = ref.exists && ref.path ? await readOptionalJson(path.join(projectRoot, ref.path)) : null;
  const exitCode = numberValue(json?.exit_code) ?? numberValue(json?.exitCode) ?? null;
  const timedOut = booleanValue(json?.timed_out) ?? booleanValue(json?.timedOut);
  return {
    id,
    ...ref,
    ...(stringValue(json?.mode) ? { mode: stringValue(json?.mode) } : {}),
    ...(stringValue(json?.operation) ? { operation: stringValue(json?.operation) } : {}),
    status: agentRunStatus(json, exitCode, timedOut),
    exit_code: exitCode,
    ...(typeof timedOut === "boolean" ? { timed_out: timedOut } : {}),
  };
}

function agentRunStatus(json: OptionalJson, exitCode: number | null, timedOut: boolean | undefined): WorkbenchStepStatus {
  if (!json) return "not_started";
  const validation = isRecord(json.validation) ? json.validation : null;
  if (stringValue(json.mode) === "diagnostic") return "diagnostic_only";
  if (timedOut || (exitCode !== null && exitCode !== 0)) return "failed";
  if (validation && validation.passed === false) return "failed";
  return "passed";
}

function htmlVideoAgentStatus(agentRuns: WorkbenchAgentRunSummary[], previewPassed: boolean): WorkbenchStepStatus {
  if (agentRuns.length === 0) return previewPassed ? "passed" : "not_started";
  const latest = agentRuns[agentRuns.length - 1];
  if (latest.status === "failed" && previewPassed) return "diagnostic_only";
  return latest.status ?? "not_started";
}

function fileStatus(ref: WorkbenchArtifact | undefined, defaultStatus: WorkbenchStepStatus): WorkbenchStepStatus {
  if (!ref?.exists || !ref.path) return "not_started";
  return defaultStatus;
}

function revisionStatus(ref: WorkbenchArtifact | undefined, previewPassed: boolean): WorkbenchStepStatus {
  if (!ref?.exists || !ref.path) return previewPassed ? "ready" : "not_started";
  return "ready";
}

async function readPrimaryRatio(
  projectRoot: string,
  animationPlan: WorkbenchFileRef,
  renderManifest: WorkbenchArtifact | undefined,
  smallProjectId: string,
): Promise<string | null> {
  const animationJson = animationPlan.exists && animationPlan.path ? await readOptionalJson(path.join(projectRoot, animationPlan.path)) : null;
  const animationRatio = stringValue(animationJson?.aspectRatio) ?? stringValue(animationJson?.aspect_ratio);
  if (animationRatio) return animationRatio;

  const renderJson = renderManifest?.exists && renderManifest.path ? await readOptionalJson(path.join(projectRoot, renderManifest.path)) : null;
  const renderRatio = stringValue(renderJson?.aspect_ratio) ?? stringValue(renderJson?.aspectRatio);
  if (renderRatio) return renderRatio;

  const projectJsonPath = path.join(projectRoot, "video", "html-video", ".html-video", "projects", smallProjectId, "project.json");
  const projectJson = await readOptionalJson(projectJsonPath);
  const preferences = isRecord(projectJson?.preferences) ? projectJson.preferences : null;
  return stringValue(preferences?.aspect) ?? null;
}

async function firstExisting(projectRoot: string, candidates: string[]): Promise<WorkbenchFileRef> {
  for (const candidate of candidates) {
    const normalized = normalizeRelativePath(candidate);
    const absolutePath = path.join(projectRoot, normalized);
    try {
      const stats = await stat(absolutePath);
      if (!stats.isFile()) continue;
      return {
        exists: true,
        path: normalized,
        sha256: await sha256File(absolutePath),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return { exists: false, path: candidates[0] ? normalizeRelativePath(candidates[0]) : undefined };
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function readOptionalJson(filePath: string): Promise<OptionalJson> {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8"));
    return isRecord(value) ? value : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function isAnimationPlanApproved(workflowCheckpoints: OptionalJson, projectStatusCache: OptionalJson): boolean {
  return approvalValue(projectStatusCache) || approvalValue(workflowCheckpoints);
}

function approvalValue(value: OptionalJson): boolean {
  if (!value) return false;
  if (value.animation_plan_approved === true) return true;
  const animationPlan = isRecord(value.animation_plan) ? value.animation_plan : null;
  if (animationPlan?.approved === true) return true;
  const approvals = isRecord(value.approvals) ? value.approvals : null;
  const approval = isRecord(approvals?.animation_plan) ? approvals.animation_plan : null;
  return approval?.approved === true;
}

function modeValue(value: unknown): WorkbenchProjectMode | null {
  return value === "image_music_mode" || value === "source_video_mode" ? value : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll(path.sep, "/");
}
