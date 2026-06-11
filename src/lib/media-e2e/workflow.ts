import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ProjectStore, type Project } from "@html-video/core";
import { validateAudioAnalysisArtifacts } from "../audio-analysis/librosa-runner.ts";
import type { BeatGrid, EnergyCurve, OnsetEvents } from "../audio-analysis/types.ts";
import { ffprobe, type MediaProbe } from "../export/ffprobe.ts";
import { validateRenderManifestV2 } from "../export/render-manifest-v2.ts";
import { validateVisualAndFinalMedia } from "../export/media-qa.ts";
import { muxLockedAudio } from "../export/mux-locked-audio.ts";
import { codexImageGenAdapter } from "../image-generation/codex-image-gen-adapter.ts";
import { readCachedImageGenerationResult } from "../image-generation/cached-image-result.ts";
import { buildLockedImageAssets, validateImageAssetReviewDecisionFile, type ImageAssetReviewDecision, type ImageDecision } from "../image-generation/image-assets.ts";
import type { ImageGenerationRequest, ImageGenerationResult } from "../image-generation/types.ts";
import { resolveSmallProjectPaths, type SmallProjectPaths } from "../project-core/paths.ts";
import { buildSectionMapFromEvidence } from "../section-map/section-map-builder.ts";
import type { AnimationPlan } from "../video-contract/animation-plan.schema.ts";
import { buildCodexFrameAgentPrompt } from "../video-html/codex-frame-agent-prompt.ts";
import { validateFrameOutputs } from "../video-html/frame-output-contract-validator.ts";
import { buildFrameContracts, type QivanceFrameContracts } from "../video-html/qivance-frame-contracts.ts";
import { ensureHtmlVideoWorkspace } from "../video-html/html-video-workspace.ts";
import { runHtmlVideoAgentRuntime } from "../video-html/html-video-agent-runtime.ts";
import { loadHtmlVideoPreviewModel, resolvePreviewFramePath } from "../video-html/preview-model.ts";
import { renderHtmlVideoVisual } from "../video-html/render-html-video.ts";
import { assertAllowedPathChanges, diffSnapshots, snapshotFiles } from "../video-html/path-gate.ts";
import { resolveMediaE2EPythonEnv, validateWhisperXPreflight, type WhisperXPreflightResult } from "./python-env.ts";
import { appendMediaE2ETestReportEvidence } from "./test-report.ts";
import { writeContractFallbackFrames } from "./contract-frame-fallback.ts";
import {
  MEDIA_E2E_RATIO_CONFIG,
  type MediaE2ERatio,
  type MediaE2EWorkflowOptions,
} from "./types.ts";
import { validateMediaE2EFixtureBundle } from "./fixture-contract.ts";
import { writeStepCheckpoint } from "./checkpoints.ts";
import { runWhisperXAlignment } from "../word-alignment/whisperx-runner.ts";

const execFileAsync = promisify(execFileCallback);

export const MEDIA_E2E_WORKFLOW_STEPS = [
  "validate_fixture_bundle",
  "analyze_audio_with_librosa",
  "align_words_with_whisperx",
  "build_section_map",
  "generate_background_images",
  "review_and_lock_image_assets",
  "write_html_video_workspace",
  "run_html_video_agent_runtime",
  "validate_frame_outputs",
  "static_preview_smoke",
  "render_visual_with_html_video",
  "mux_active_mp3_to_final_aac",
  "ffprobe_visual_and_final",
  "write_render_manifest",
  "append_test_report_evidence",
] as const;

export type MediaE2EWorkflowStep = typeof MEDIA_E2E_WORKFLOW_STEPS[number];

export type InjectedMediaE2ESteps = Record<MediaE2EWorkflowStep, () => Promise<unknown>>;

export type MediaE2EWorkflowResult = {
  ratio: MediaE2ERatio;
  projectId: string;
  projectRoot: string;
  manifestPath: string;
  finalMp4Path: string;
  status: "passed";
};

export function validateMediaE2EProductionGates(input: {
  cachedImagegenRequests: string[];
  fallbackFramePaths: string[];
  htmlVideoRuntimeExitCode: number | null;
  allowCachedImagegen?: boolean;
  allowFallbackFrames?: boolean;
}): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (input.cachedImagegenRequests.length > 0 && !input.allowCachedImagegen) {
    issues.push(`cached imagegen evidence is not allowed in production-strict E2E: ${input.cachedImagegenRequests.join(", ")}`);
  }
  if ((input.htmlVideoRuntimeExitCode !== null && input.htmlVideoRuntimeExitCode !== 0) && !input.allowFallbackFrames) {
    issues.push("AI-authored html-video frames require a clean runtime exit in production-strict E2E");
  }
  if (input.fallbackFramePaths.length > 0 && !input.allowFallbackFrames) {
    issues.push(`fallback frame evidence is not allowed in production-strict E2E: ${input.fallbackFramePaths.join(", ")}`);
  }
  return { ok: issues.length === 0, issues };
}

export async function runMediaE2EWorkflowWithInjectedSteps(input: { steps: InjectedMediaE2ESteps }): Promise<void> {
  for (const step of MEDIA_E2E_WORKFLOW_STEPS) {
    await input.steps[step]();
  }
}

export async function runMediaE2EWorkflow(
  options: MediaE2EWorkflowOptions & { fixtureRoot?: string; storageRoot?: string; htmlVideoAgentId?: string; htmlVideoModel?: string; htmlVideoRuntimeTimeoutMs?: number; whisperxTimeoutMs?: number } = {},
): Promise<MediaE2EWorkflowResult> {
  const ratio = options.fixtureRatio ?? "portrait-9x16";
  const fixtureRoot = path.resolve(options.fixtureRoot ?? "fixtures/media-e2e-v2");
  const storageRoot = path.resolve(options.storageRoot ?? "projects");
  const bundlePath = path.join(fixtureRoot, ratio);
  const fixturePlan = await readJson<FixtureAnimationPlan>(path.join(bundlePath, "animation_plan.json"));
  const projectId = fixturePlan.small_project_id;
  const paths = resolveSmallProjectPaths(storageRoot, projectId);
  const runId = `media_e2e_v2_${ratio}_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const context: WorkflowContext = {
    ratio,
    runId,
    bundlePath,
    paths,
    fixturePlan,
    fixtureImagePlan: await readJson<FixtureImageGenerationPlan>(path.join(bundlePath, "image_generation_plan.json")),
    pythonEnv: resolveMediaE2EPythonEnv(),
    steps: [],
    imageResults: [],
    lockedImageAssets: null,
    animationPlan: null,
    frameContracts: null,
    visualProbe: null,
    finalProbe: null,
    diagnostics: [],
    cachedImagegenRequests: [],
    fallbackFramePaths: [],
    htmlVideoRuntimeExitCode: null,
    reviewDecisionSource: null,
    reviewDecisionPath: null,
    whisperxPreflight: null,
  };

  await runStep(context, "validate_fixture_bundle", async () => {
    const validation = await validateMediaE2EFixtureBundle({ bundlePath, ratio });
    if (!validation.ok) throw new Error(validation.issues.join("; "));
    await mkdir(paths.projectRoot, { recursive: true });
    await mkdir(paths.audioMasterDir, { recursive: true });
    await copyFile(path.join(bundlePath, "active_music_take.mp3"), audioMp3Path(paths));
    await mkdir(paths.timingDir, { recursive: true });
    await copyFile(path.join(bundlePath, "lyrics.md"), path.join(paths.timingDir, "lyrics.md"));
  });

  await runStep(context, "analyze_audio_with_librosa", async () => {
    const outputDir = path.join(paths.projectRoot, "data", "audio_analysis");
    await mkdir(outputDir, { recursive: true });
    await execFileAsync(context.pythonEnv.pythonExecutable, [
      path.resolve("scripts/python/analyze-audio-librosa.py"),
      audioMp3Path(paths),
      outputDir,
    ]);
    const beatGrid = await readJson<BeatGrid>(path.join(outputDir, "beat_grid.json"));
    const onsetEvents = await readJson<OnsetEvents>(path.join(outputDir, "onset_events.json"));
    const energyCurve = await readJson<EnergyCurve>(path.join(outputDir, "energy_curve.json"));
    const validation = validateAudioAnalysisArtifacts({
      expectedDurationSec: fixturePlan.duration_sec,
      beatGrid,
      onsetEvents,
      energyCurve,
    });
    if (!validation.ok) throw new Error(validation.issues.join("; "));
    await copyFile(path.join(outputDir, "beat_grid.json"), path.join(paths.timingDir, "beat_grid.json"));
    await copyFile(path.join(outputDir, "onset_events.json"), path.join(paths.timingDir, "onset_events.json"));
    await copyFile(path.join(outputDir, "energy_curve.json"), path.join(paths.timingDir, "energy_curve.json"));
  });

  await runStep(context, "align_words_with_whisperx", async () => {
    context.whisperxPreflight = validateWhisperXPreflight({
      pythonEnv: context.pythonEnv,
      allowCpuDiagnostic: options.allowCpuWhisperXDiagnostic,
      requireGpu: options.requireGpu ?? context.pythonEnv.whisperx.requireGpu,
    });
    context.diagnostics.push(...context.whisperxPreflight.diagnostics);
    if (!context.whisperxPreflight.ok) throw new Error(context.whisperxPreflight.issues.join("; "));

    await runWhisperXAlignment({
      pythonExecutable: context.pythonEnv.pythonExecutable,
      scriptPath: path.resolve("scripts/python/align-lyrics-whisperx.py"),
      audioPath: audioMp3Path(paths),
      lyricsPath: path.join(paths.timingDir, "lyrics.md"),
      wordTimingPath: path.join(paths.timingDir, "lyric_word_timing.json"),
      reportPath: path.join(paths.timingDir, "alignment_report.json"),
      language: "zh",
      device: context.pythonEnv.whisperx.device,
      model: context.pythonEnv.whisperx.model,
      cacheDir: context.pythonEnv.whisperx.cacheDir,
      requireGpu: options.requireGpu ?? context.pythonEnv.whisperx.requireGpu,
      timeoutMs: options.whisperxTimeoutMs ?? 10 * 60 * 1000,
    });
  });

  await runStep(context, "build_section_map", async () => {
    const wordTiming = await readJson<LyricWordTimingJson>(path.join(paths.timingDir, "lyric_word_timing.json"));
    const beatGrid = await readJson<BeatGrid>(path.join(paths.timingDir, "beat_grid.json"));
    const sectionMap = buildSectionMapFromEvidence({
      durationSec: fixturePlan.duration_sec,
      scenes: fixturePlan.scenes,
      words: wordTiming.words,
      beats: beatGrid.beats,
    });
    await writeJson(path.join(paths.timingDir, "section_map.json"), sectionMap);
  });

  await runStep(context, "generate_background_images", async () => {
    const outputDir = path.join(paths.projectRoot, "assets", "generated-backgrounds");
    await mkdir(outputDir, { recursive: true });
    for (const request of context.fixtureImagePlan.requests) {
      const imageRequest = toImageGenerationRequest(request, outputDir);
      const cached = await readCachedImageGenerationResult(imageRequest);
      const result = cached ?? await codexImageGenAdapter.generateImageCandidates(imageRequest);
      if (cached) {
        context.cachedImagegenRequests.push(request.request_id);
        context.diagnostics.push(`reused cached image candidates for ${request.request_id}`);
      }
      if (result.candidates.length === 0) throw new Error(`image_gen returned no candidates: ${request.request_id}`);
      context.imageResults.push(result);
    }
    await writeJson(imageGenerationResultsPath(paths), {
      schema_version: 1,
      small_project_id: projectId,
      results: context.imageResults,
    });
    const gate = validateMediaE2EProductionGates({
      cachedImagegenRequests: context.cachedImagegenRequests,
      fallbackFramePaths: [],
      htmlVideoRuntimeExitCode: 0,
      allowCachedImagegen: options.allowCachedImagegen,
      allowFallbackFrames: options.allowFallbackFrames,
    });
    if (!gate.ok) throw new Error(gate.issues.join("; "));
  });

  await runStep(context, "review_and_lock_image_assets", async () => {
    const decisionPath = options.reviewDecisionPath ? path.resolve(options.reviewDecisionPath) : defaultReviewDecisionPath(paths);
    const reviewDecisionFile = await readOptionalJson<unknown>(decisionPath);
    let decisions: ImageDecision[];

    if (reviewDecisionFile) {
      const validation = validateImageAssetReviewDecisionFile({
        review: reviewDecisionFile,
        smallProjectId: projectId,
        candidateIds: context.imageResults.flatMap((result) => result.candidates.map((candidate) => candidate.candidateId)),
      });
      if (!validation.ok) throw new Error(validation.issues.join("; "));
      decisions = imageDecisionsFromReview(context, validation.decisions, decisionPath);
      context.reviewDecisionSource = "file";
      context.reviewDecisionPath = decisionPath;
    } else {
      if (!options.allowAutoLockImageAssets) {
        throw new Error(`image review decision file is required for production-strict E2E: ${decisionPath}`);
      }
      decisions = autoLockPreferredImageDecisions(context);
      context.reviewDecisionSource = "auto-lock-diagnostic";
      context.diagnostics.push("auto-locked preferred image candidates for diagnostic run");
    }

    context.lockedImageAssets = buildLockedImageAssets({ smallProjectId: projectId, decisions });
    if (context.lockedImageAssets.assets.length === 0) throw new Error("no locked generated background assets");
    await writeJson(path.join(paths.projectRoot, "assets", "image_assets.json"), context.lockedImageAssets);
  });

  await runStep(context, "write_html_video_workspace", async () => {
    context.animationPlan = toHtmlVideoAnimationPlan(fixturePlan, context.lockedImageAssets?.assets ?? []);
    context.frameContracts = withMp3MasterAudio(buildFrameContracts({ plan: context.animationPlan, paths }));
    await ensureHtmlVideoWorkspace({
      paths,
      animationPlan: context.animationPlan,
      contentGraph: (await import("../video-html/animation-plan-to-content-graph.ts")).animationPlanToContentGraph(context.animationPlan),
      frameContracts: context.frameContracts,
    });
    await writeJson(paths.frameContractsPath, context.frameContracts);
    await rewriteAgentContextForV2(paths);
    await writeFile(paths.codexPromptPath, buildCodexFrameAgentPrompt({
      smallProjectId: projectId,
      agentContextPath: "codex/agent_context.json",
      contentGraphPath: "content-graph.json",
      frameContractsPath: "qivance-frame-contracts.json",
    }), "utf8");
  });

  await runStep(context, "run_html_video_agent_runtime", async () => {
    const before = await snapshotFiles(paths.htmlVideoProjectDir);
    const result = await runHtmlVideoAgentRuntime({
      projectDir: paths.htmlVideoProjectDir,
      promptPath: paths.codexPromptPath,
      agentId: options.htmlVideoAgentId ?? "codex",
      model: options.htmlVideoModel,
      timeoutMs: options.htmlVideoRuntimeTimeoutMs ?? parseOptionalPositiveInt(process.env.QIVANCE_HTML_VIDEO_RUNTIME_TIMEOUT_MS) ?? 2 * 60 * 1000,
    });
    context.htmlVideoRuntimeExitCode = result.exitCode;
    await writeJson(path.join(paths.codexDir, "html-video-runtime-result.json"), result);
    if (result.exitCode !== 0) {
      context.diagnostics.push(`html-video agent runtime did not complete cleanly: ${result.stderr || `exit ${result.exitCode}`}`);
    }
    assertAllowedPathChanges(diffSnapshots(before, await snapshotFiles(paths.htmlVideoProjectDir)));
    const fallbackFrames = await writeContractFallbackFrames({
      paths,
      contracts: requiredFrameContracts(context),
      animationPlan: requiredAnimationPlan(context),
      imageAssets: context.lockedImageAssets?.assets ?? [],
    });
    context.fallbackFramePaths = fallbackFrames;
    if (fallbackFrames.length > 0) {
      context.diagnostics.push(`html-video runtime missing ${fallbackFrames.length} frame(s); generated contract fallback frames`);
    }
    const gate = validateMediaE2EProductionGates({
      cachedImagegenRequests: [],
      fallbackFramePaths: fallbackFrames,
      htmlVideoRuntimeExitCode: result.exitCode,
      allowCachedImagegen: options.allowCachedImagegen,
      allowFallbackFrames: options.allowFallbackFrames,
    });
    if (!gate.ok) throw new Error(gate.issues.join("; "));
    await syncProjectFramesFromContracts(paths, requiredFrameContracts(context));
  });

  await runStep(context, "validate_frame_outputs", async () => {
    const frameValidation = await validateFrameOutputs({
      framesDir: paths.framesDir,
      contracts: requiredFrameContracts(context),
      allowedLocalImagePaths: (context.lockedImageAssets?.assets ?? []).map((asset: any) => asset.path),
    });
    if (!frameValidation.ok) throw new Error(frameValidation.issues.join("; "));
  });

  await runStep(context, "static_preview_smoke", async () => {
    const preview = await loadHtmlVideoPreviewModel(paths);
    if (preview.frames.length !== Object.keys(requiredFrameContracts(context).frames).length) {
      throw new Error("preview frame count does not match contracts");
    }
    for (const frame of preview.frames) {
      const resolved = resolvePreviewFramePath(paths, path.basename(frame.htmlPath));
      await stat(resolved);
    }
  });

  await runStep(context, "render_visual_with_html_video", async () => {
    await renderHtmlVideoVisual({ paths, outputPath: visualSilentMp4Path(paths) });
    await stat(visualSilentMp4Path(paths));
  });

  await runStep(context, "mux_active_mp3_to_final_aac", async () => {
    await muxLockedAudio({
      visualMp4Path: visualSilentMp4Path(paths),
      masterAudioPath: audioMp3Path(paths),
      finalMp4Path: paths.finalMp4Path,
    });
    await stat(paths.finalMp4Path);
  });

  await runStep(context, "ffprobe_visual_and_final", async () => {
    context.visualProbe = await ffprobe(visualSilentMp4Path(paths));
    context.finalProbe = await ffprobe(paths.finalMp4Path);
    const validation = validateVisualAndFinalMedia({
      visualProbe: context.visualProbe,
      finalProbe: context.finalProbe,
      expected: {
        durationSec: fixturePlan.duration_sec,
        fps: fixturePlan.fps,
        resolution: fixturePlan.resolution,
      },
    });
    if (!validation.ok) throw new Error(validation.issues.join("; "));
  });

  await runStep(context, "write_render_manifest", async () => {
    const manifest = await buildManifest(context, options);
    const validation = validateRenderManifestV2(manifest);
    if (!validation.ok) throw new Error(`render manifest evidence is incomplete: ${validation.issues.join("; ")}`);
    await writeJson(paths.renderManifestPath, manifest);
  });

  await runStep(context, "append_test_report_evidence", async () => {
    await appendMediaE2ETestReportEvidence({
      reportPath: options.reportPath ?? "docs/TEST_REPORT.v2.md",
      ratio,
      manifestPath: paths.renderManifestPath,
      status: "passed",
      evidenceStatus: {
        liveImagegenPassed: context.cachedImagegenRequests.length === 0,
        aiAuthoredFramesPassed: context.htmlVideoRuntimeExitCode === 0 && context.fallbackFramePaths.length === 0,
        reviewDecisionSource: context.reviewDecisionSource,
      },
    });
  });

  return {
    ratio,
    projectId,
    projectRoot: paths.projectRoot,
    manifestPath: paths.renderManifestPath,
    finalMp4Path: paths.finalMp4Path,
    status: "passed",
  };
}

type WorkflowContext = {
  ratio: MediaE2ERatio;
  runId: string;
  bundlePath: string;
  paths: SmallProjectPaths;
  fixturePlan: FixtureAnimationPlan;
  fixtureImagePlan: FixtureImageGenerationPlan;
  pythonEnv: ReturnType<typeof resolveMediaE2EPythonEnv>;
  steps: Array<Record<string, unknown>>;
  imageResults: ImageGenerationResult[];
  lockedImageAssets: any;
  animationPlan: AnimationPlan | null;
  frameContracts: QivanceFrameContracts | null;
  visualProbe: MediaProbe | null;
  finalProbe: MediaProbe | null;
  diagnostics: string[];
  cachedImagegenRequests: string[];
  fallbackFramePaths: string[];
  htmlVideoRuntimeExitCode: number | null;
  reviewDecisionSource: string | null;
  reviewDecisionPath: string | null;
  whisperxPreflight: WhisperXPreflightResult | null;
};

type FixtureAnimationPlan = {
  schema_version: 1;
  small_project_id: string;
  aspect_ratio: "9:16" | "16:9" | "1:1";
  resolution: { width: number; height: number };
  fps: number;
  duration_sec: number;
  scenes: Array<{
    scene_id: string;
    section_ids: string[];
    start_sec: number;
    end_sec: number;
    image_generation: { enabled: boolean };
  }>;
};

type FixtureImageGenerationPlan = {
  schema_version: 1;
  small_project_id: string;
  requests: Array<{
    request_id: string;
    scene_id: string;
    asset_role: "background";
    prompt: string;
    reference_asset_ids: string[];
    aspect_ratio: "9:16" | "16:9" | "1:1";
    target_size: { width: number; height: number };
    variants: number;
  }>;
};

type LyricWordTimingJson = {
  words: Array<{
    word_id: string;
    paragraph_id: string;
    start_sec: number;
    end_sec: number;
  }>;
};

async function runStep(context: WorkflowContext, step: MediaE2EWorkflowStep, fn: () => Promise<void>): Promise<void> {
  const startedAt = new Date().toISOString();
  const diagnosticStart = context.diagnostics.length;
  try {
    await fn();
    const checkpoint = {
      step,
      status: "passed" as const,
      inputs: [],
      outputs: [],
      diagnostics: context.diagnostics.slice(diagnosticStart),
      startedAt,
      completedAt: new Date().toISOString(),
    };
    context.steps.push(checkpoint);
    await writeStepCheckpoint(context.paths.projectRoot, checkpoint);
  } catch (error) {
    const checkpoint = {
      step,
      status: "failed" as const,
      inputs: [],
      outputs: [],
      diagnostics: [...context.diagnostics.slice(diagnosticStart), error instanceof Error ? error.message : String(error)],
      startedAt,
      completedAt: new Date().toISOString(),
    };
    context.steps.push(checkpoint);
    await writeStepCheckpoint(context.paths.projectRoot, checkpoint);
    throw error;
  }
}

function toImageGenerationRequest(request: FixtureImageGenerationPlan["requests"][number], outputDir: string): ImageGenerationRequest {
  return {
    requestId: request.request_id,
    sceneId: request.scene_id,
    assetRole: request.asset_role,
    prompt: request.prompt,
    referenceAssetIds: request.reference_asset_ids,
    aspectRatio: request.aspect_ratio,
    targetSize: request.target_size,
    variants: request.variants,
    outputDir,
  };
}

function toHtmlVideoAnimationPlan(plan: FixtureAnimationPlan, imageAssets: any[]): AnimationPlan {
  return {
    schemaVersion: 1,
    smallProjectId: plan.small_project_id,
    title: plan.small_project_id,
    category: "ai_concept",
    targetDurationSec: plan.duration_sec,
    fps: plan.fps,
    resolution: plan.resolution,
    aspectRatio: plan.aspect_ratio,
    mood: "production media e2e",
    synopsis: "V2 media E2E fixture",
    scenes: plan.scenes.map((scene, index) => ({
      id: scene.scene_id,
      order: index,
      sectionId: scene.section_ids[0] ?? scene.scene_id,
      startSec: scene.start_sec,
      endSec: scene.end_sec,
      durationSec: round(scene.end_sec - scene.start_sec),
      frameIntent: scene.image_generation.enabled ? "generated background scene" : "lyric-driven motion scene",
      headline: scene.section_ids[0] ?? scene.scene_id,
      bodyLines: [],
      captionMode: "line_caption",
      visualDirectives: scene.image_generation.enabled ? ["use locked generated background"] : ["no external media"],
      beatSync: { intensity: scene.image_generation.enabled ? 0.8 : 0.55 },
      assets: imageAssets
        .filter((asset) => asset.scene_id === scene.scene_id)
        .map((asset) => ({ id: asset.asset_id, type: "image", path: asset.path, role: asset.role })),
    })),
  };
}

function withMp3MasterAudio(contracts: QivanceFrameContracts): QivanceFrameContracts {
  return { ...contracts, masterAudioPath: "audio/master/active_music_take.mp3" };
}

async function rewriteAgentContextForV2(paths: SmallProjectPaths): Promise<void> {
  const context = await readJson<any>(paths.codexAgentContextPath);
  context.sourceFiles.masterAudio = "../../../audio/master/active_music_take.mp3";
  await writeJson(paths.codexAgentContextPath, context);
}

async function syncProjectFramesFromContracts(paths: SmallProjectPaths, contracts: QivanceFrameContracts): Promise<void> {
  const store = new ProjectStore(paths.htmlVideoRoot);
  const project = await store.load(paths.smallProjectId);
  const frames = Object.values(contracts.frames)
    .sort((a, b) => a.order - b.order)
    .map((contract) => ({
      graphNodeId: contract.graphNodeId,
      htmlPath: `${paths.htmlVideoProjectDir}/${contract.allowedHtmlPath}`,
      durationSec: contract.durationSec,
      order: contract.order,
    }));
  const nextProject: Project = {
    ...project,
    frames,
    lastPreviewHtmlPath: frames[0]?.htmlPath,
    status: "previewed",
  };
  await store.save(nextProject);
}

async function buildManifest(context: WorkflowContext, options: MediaE2EWorkflowOptions): Promise<Record<string, unknown>> {
  const paths = context.paths;
  return {
    schema_version: 2,
    project_id: paths.smallProjectId,
    aspect_ratio: context.fixturePlan.aspect_ratio,
    resolution: context.fixturePlan.resolution,
    fps: context.fixturePlan.fps,
    workflow_run_id: context.runId,
    status: "passed",
    evidence_status: {
      media_export_passed: true,
      live_imagegen_passed: context.cachedImagegenRequests.length === 0,
      ai_authored_frames_passed: context.htmlVideoRuntimeExitCode === 0 && context.fallbackFramePaths.length === 0,
      strict: {
        production_default: true,
        allow_cached_imagegen: Boolean(options.allowCachedImagegen),
        allow_fallback_frames: Boolean(options.allowFallbackFrames),
        allow_auto_lock_image_assets: Boolean(options.allowAutoLockImageAssets),
      },
      review_decision_source: context.reviewDecisionSource,
    },
    steps: context.steps,
    inputs: {
      fixture_bundle: context.bundlePath,
      active_music_take_mp3: await evidence(audioMp3Path(paths)),
      lyrics_md: await evidence(path.join(paths.timingDir, "lyrics.md")),
    },
    audio_analysis: {
      beat_grid: await evidence(path.join(paths.timingDir, "beat_grid.json")),
      onset_events: await evidence(path.join(paths.timingDir, "onset_events.json")),
      energy_curve: await evidence(path.join(paths.timingDir, "energy_curve.json")),
      python: context.pythonEnv.pythonExecutable,
      requirements: context.pythonEnv.requirementsPath,
    },
    word_alignment: {
      backend: "whisperx",
      env: context.pythonEnv.whisperx,
      preflight: context.whisperxPreflight,
      lyric_word_timing: await evidence(path.join(paths.timingDir, "lyric_word_timing.json")),
      alignment_report: await evidence(path.join(paths.timingDir, "alignment_report.json")),
    },
    image_generation: {
      adapter_id: "codex_image_gen",
      image_generation_results: await evidence(imageGenerationResultsPath(paths)),
      image_assets: await evidence(path.join(paths.projectRoot, "assets", "image_assets.json")),
      review_decisions: context.reviewDecisionPath ? await evidence(context.reviewDecisionPath) : null,
      cached_request_ids: context.cachedImagegenRequests,
      results: context.imageResults,
    },
    html_video: {
      project_dir: paths.htmlVideoProjectDir,
      content_graph: await evidence(paths.contentGraphPath),
      frame_contracts: await evidence(paths.frameContractsPath),
      agent_context: await evidence(paths.codexAgentContextPath),
      frames: await frameEvidence(paths, requiredFrameContracts(context)),
      runtime_exit_code: context.htmlVideoRuntimeExitCode,
      fallback_frame_paths: context.fallbackFramePaths,
      frame_authoring_diagnostics: context.diagnostics.filter((item) => item.includes("html-video")),
    },
    render: {
      duration_mode: "explicit",
      visual_silent_mp4: await evidence(visualSilentMp4Path(paths)),
      visual_probe: context.visualProbe,
    },
    mux: {
      source_audio_codec: "mp3",
      final_audio_codec: "aac",
      final_mp4: await evidence(paths.finalMp4Path),
      final_probe: context.finalProbe,
    },
    qa: {
      duration_drift_sec: context.finalProbe ? round(Math.abs(context.finalProbe.durationSec - context.fixturePlan.duration_sec)) : null,
      final_has_single_audio_stream: context.finalProbe?.audioStreamCount === 1,
    },
    diagnostics: context.diagnostics,
  };
}

function imageDecisionsFromReview(
  context: WorkflowContext,
  reviewDecisions: ImageAssetReviewDecision[],
  decisionPath: string,
): ImageDecision[] {
  const candidates = candidateMap(context);
  return reviewDecisions.map((decision) => {
    const candidate = candidates.get(decision.candidateId);
    if (!candidate) throw new Error(`missing generated image candidate for review decision: ${decision.candidateId}`);
    return {
      candidateId: decision.candidateId,
      sceneId: requestSceneId(context.fixtureImagePlan, candidate.requestId),
      role: "background",
      path: candidate.path,
      sha256: candidate.sha256,
      prompt: requestPrompt(context.fixtureImagePlan, candidate.requestId),
      status: decision.status,
      decisionSource: decisionPath,
      ...(decision.reason ? { reason: decision.reason } : {}),
      ...(decision.decidedBy ? { decidedBy: decision.decidedBy } : {}),
      ...(decision.decidedAt ? { decidedAt: decision.decidedAt } : {}),
    };
  });
}

function autoLockPreferredImageDecisions(context: WorkflowContext): ImageDecision[] {
  return context.imageResults.flatMap((result) =>
    result.candidates.slice(0, 1).map((candidate) => ({
      candidateId: candidate.candidateId,
      sceneId: requestSceneId(context.fixtureImagePlan, result.requestId),
      role: "background" as const,
      path: candidate.path,
      sha256: candidate.sha256,
      prompt: requestPrompt(context.fixtureImagePlan, result.requestId),
      status: "locked" as const,
      decisionSource: "auto-lock-diagnostic",
    }))
  );
}

function candidateMap(context: WorkflowContext): Map<string, ImageGenerationResult["candidates"][number] & { requestId: string }> {
  const map = new Map<string, ImageGenerationResult["candidates"][number] & { requestId: string }>();
  for (const result of context.imageResults) {
    for (const candidate of result.candidates) map.set(candidate.candidateId, { ...candidate, requestId: result.requestId });
  }
  return map;
}

async function frameEvidence(paths: SmallProjectPaths, contracts: QivanceFrameContracts): Promise<Array<Record<string, unknown>>> {
  return await Promise.all(Object.values(contracts.frames)
    .sort((a, b) => a.order - b.order)
    .map((contract) => evidence(path.join(paths.framesDir, path.basename(contract.allowedHtmlPath)))));
}

async function readOptionalJson<T>(filePath: string): Promise<T | null> {
  try {
    return await readJson<T>(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function imageGenerationResultsPath(paths: SmallProjectPaths): string {
  return path.join(paths.projectRoot, "assets", "image_generation_results.json");
}

function defaultReviewDecisionPath(paths: SmallProjectPaths): string {
  return path.join(paths.projectRoot, "assets", "image_review_decisions.json");
}

function requiredFrameContracts(context: WorkflowContext): QivanceFrameContracts {
  if (!context.frameContracts) throw new Error("frame contracts are not built");
  return context.frameContracts;
}

function requiredAnimationPlan(context: WorkflowContext): AnimationPlan {
  if (!context.animationPlan) throw new Error("animation plan is not built");
  return context.animationPlan;
}

function parseOptionalPositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1000) throw new Error("QIVANCE_HTML_VIDEO_RUNTIME_TIMEOUT_MS must be an integer >= 1000");
  return parsed;
}

function requestSceneId(plan: FixtureImageGenerationPlan, requestId: string): string {
  return plan.requests.find((request) => request.request_id === requestId)?.scene_id ?? requestId;
}

function requestPrompt(plan: FixtureImageGenerationPlan, requestId: string): string {
  return plan.requests.find((request) => request.request_id === requestId)?.prompt ?? "";
}

function audioMp3Path(paths: SmallProjectPaths): string {
  return path.join(paths.audioMasterDir, "active_music_take.mp3");
}

function visualSilentMp4Path(paths: SmallProjectPaths): string {
  return path.join(paths.exportsDir, "visual_silent.mp4");
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function evidence(filePath: string): Promise<Record<string, unknown>> {
  return { path: filePath, sha256: await sha256(filePath) };
}

async function sha256(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
