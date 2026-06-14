export type RenderManifestV3ProjectMode = "image_music_mode" | "source_video_mode";

export type RenderManifestV3EvidenceRef = {
  path: string;
  sha256: string;
};

export type RenderManifestV3AgentRunRef = RenderManifestV3EvidenceRef & {
  mode: "production" | "diagnostic";
  ai_authored_frame_count: number;
};

export type RenderManifestV3SourceVideo =
  | { enabled: false }
  | (RenderManifestV3EvidenceRef & {
    enabled: true;
    audio_policy: "preserve_source_audio";
    final_audio_source: string;
    source_mp4_sha256: string;
    ffprobe: unknown;
  });

export type RenderManifestV3Evidence = {
  workbench: {
    primary_ratio: "9:16" | "16:9" | "1:1";
    project_mode: RenderManifestV3ProjectMode;
  };
  image_schedule?: RenderManifestV3EvidenceRef;
  image_prompt_group?: RenderManifestV3EvidenceRef;
  image_review_decisions?: RenderManifestV3EvidenceRef;
  agent_runs: RenderManifestV3AgentRunRef[];
  source_video: RenderManifestV3SourceVideo;
  production_evidence: {
    fallback_frames_used: boolean;
    diagnostic_flags_used: string[];
  };
};

export type RenderManifestV3 = {
  schema_version: 3;
  small_project_id: string;
  status: "passed" | "failed";
  v3: RenderManifestV3Evidence;
};

export type RenderManifestV3ValidationResult = {
  ok: boolean;
  issues: string[];
};

export function buildRenderManifestV3(input: {
  smallProjectId: string;
  status?: "passed" | "failed";
  primaryRatio: "9:16" | "16:9" | "1:1";
  projectMode: RenderManifestV3ProjectMode;
  imageSchedule?: RenderManifestV3EvidenceRef;
  imagePromptGroup?: RenderManifestV3EvidenceRef;
  imageReviewDecisions?: RenderManifestV3EvidenceRef;
  agentRuns: RenderManifestV3AgentRunRef[];
  sourceVideo?: RenderManifestV3SourceVideo;
  fallbackFramesUsed?: boolean;
  diagnosticFlagsUsed?: string[];
}): RenderManifestV3 {
  return {
    schema_version: 3,
    small_project_id: input.smallProjectId,
    status: input.status ?? "passed",
    v3: {
      workbench: {
        primary_ratio: input.primaryRatio,
        project_mode: input.projectMode,
      },
      ...(input.imageSchedule ? { image_schedule: input.imageSchedule } : {}),
      ...(input.imagePromptGroup ? { image_prompt_group: input.imagePromptGroup } : {}),
      ...(input.imageReviewDecisions ? { image_review_decisions: input.imageReviewDecisions } : {}),
      agent_runs: input.agentRuns,
      source_video: input.sourceVideo ?? { enabled: false },
      production_evidence: {
        fallback_frames_used: Boolean(input.fallbackFramesUsed),
        diagnostic_flags_used: input.diagnosticFlagsUsed ?? [],
      },
    },
  };
}

export function validateRenderManifestV3(manifest: unknown): RenderManifestV3ValidationResult {
  const issues: string[] = [];
  const root = isRecord(manifest) ? manifest : null;
  if (!root) return { ok: false, issues: ["render manifest v3 must be a JSON object"] };
  if (root.schema_version !== 3) issues.push("schema_version must be 3");
  if (typeof root.small_project_id !== "string" || root.small_project_id.length === 0) issues.push("small_project_id is required");
  if (root.status !== "passed" && root.status !== "failed") issues.push("status must be passed or failed");

  const v3 = requireRecord(root.v3, "v3", issues);
  if (!v3) return { ok: false, issues };
  const workbench = requireRecord(v3.workbench, "v3.workbench", issues);
  const projectMode = workbench?.project_mode;
  if (workbench) {
    if (!["9:16", "16:9", "1:1"].includes(String(workbench.primary_ratio))) issues.push("v3.workbench.primary_ratio must be 9:16, 16:9, or 1:1");
    if (projectMode !== "image_music_mode" && projectMode !== "source_video_mode") {
      issues.push("v3.workbench.project_mode must be image_music_mode or source_video_mode");
    }
  }

  const agentRuns = Array.isArray(v3.agent_runs) ? v3.agent_runs : null;
  if (!agentRuns || agentRuns.length === 0) {
    issues.push("v3.agent_runs must include at least one production agent run");
  } else {
    agentRuns.forEach((run, index) => validateAgentRunRef(run, `v3.agent_runs[${index}]`, issues));
  }

  const productionEvidence = requireRecord(v3.production_evidence, "v3.production_evidence", issues);
  if (productionEvidence) {
    if (productionEvidence.fallback_frames_used !== false) issues.push("v3.production_evidence.fallback_frames_used must be false");
    if (!Array.isArray(productionEvidence.diagnostic_flags_used)) {
      issues.push("v3.production_evidence.diagnostic_flags_used must be an array");
    } else if (productionEvidence.diagnostic_flags_used.length > 0) {
      issues.push("v3.production_evidence.diagnostic_flags_used must be empty for production success");
    }
  }

  if (projectMode === "image_music_mode") {
    requireEvidence(v3.image_schedule, "v3.image_schedule", issues);
    requireEvidence(v3.image_prompt_group, "v3.image_prompt_group", issues);
    requireEvidence(v3.image_review_decisions, "v3.image_review_decisions", issues);
    const sourceVideo = requireRecord(v3.source_video, "v3.source_video", issues);
    if (sourceVideo && sourceVideo.enabled !== false) issues.push("v3.source_video.enabled must be false for image_music_mode");
  }

  if (projectMode === "source_video_mode") {
    const sourceVideo = requireRecord(v3.source_video, "v3.source_video", issues);
    if (sourceVideo) {
      if (sourceVideo.enabled !== true) issues.push("v3.source_video.enabled must be true for source_video_mode");
      requireEvidence(sourceVideo, "v3.source_video", issues);
      if (sourceVideo.audio_policy !== "preserve_source_audio") issues.push("v3.source_video.audio_policy must be preserve_source_audio");
      if (typeof sourceVideo.final_audio_source !== "string" || sourceVideo.final_audio_source.length === 0) {
        issues.push("v3.source_video.final_audio_source is required");
      }
      if (typeof sourceVideo.source_mp4_sha256 !== "string" || sourceVideo.source_mp4_sha256.length === 0) {
        issues.push("v3.source_video.source_mp4_sha256 is required");
      }
      if (sourceVideo.ffprobe === undefined) issues.push("v3.source_video.ffprobe is required");
    }
  }

  return { ok: issues.length === 0, issues };
}

function validateAgentRunRef(value: unknown, label: string, issues: string[]): void {
  const run = isRecord(value) ? value : null;
  if (!run) {
    issues.push(`${label} must be an object`);
    return;
  }
  requireEvidence(run, label, issues);
  if (run.mode !== "production") issues.push(`${label}.mode must be production`);
  if (typeof run.ai_authored_frame_count !== "number" || run.ai_authored_frame_count <= 0) {
    issues.push(`${label}.ai_authored_frame_count must be greater than 0`);
  }
}

function requireEvidence(value: unknown, label: string, issues: string[]): void {
  if (!isEvidence(value)) issues.push(`${label} must include path and sha256`);
}

function isEvidence(value: unknown): value is RenderManifestV3EvidenceRef {
  return isRecord(value) && typeof value.path === "string" && value.path.length > 0 && typeof value.sha256 === "string" && value.sha256.length > 0;
}

function requireRecord(value: unknown, label: string, issues: string[]): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  issues.push(`${label} must be an object`);
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
