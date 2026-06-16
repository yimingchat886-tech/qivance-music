export function buildRenderManifestV2(input: {
  projectId: string;
  aspectRatio: "9:16" | "16:9" | "1:1";
  resolution: { width: number; height: number };
  fps: number;
  workflowRunId: string;
  status: "passed" | "failed";
}) {
  return {
    schema_version: 2,
    project_id: input.projectId,
    aspect_ratio: input.aspectRatio,
    resolution: input.resolution,
    fps: input.fps,
    workflow_run_id: input.workflowRunId,
    status: input.status,
    evidence_status: {
      media_export_passed: input.status === "passed",
      live_imagegen_passed: false,
      ai_authored_frames_passed: false,
      strict: {
        production_default: true,
        allow_cached_imagegen: false,
        allow_fallback_frames: false,
        allow_auto_lock_image_assets: false,
      },
      review_decision_source: null,
    },
    steps: [],
    inputs: {},
    audio_analysis: {},
    word_alignment: {
      backend: "whisperx",
      metrics: {
        word_coverage: null,
        low_confidence_ratio: null,
        unmatched_ratio: null,
        section_duration_coverage: null,
        section_boundary_evidence_drift_sec: null,
      },
    },
    image_generation: {},
    html_video: {},
    render: { duration_mode: "explicit" },
    mux: {
      source_audio_codec: "mp3",
      final_audio_codec: "aac",
    },
    qa: {},
    diagnostics: [],
  };
}

export type RenderManifestValidationResult = { ok: boolean; issues: string[] };

export function validateRenderManifestV2(manifest: unknown): RenderManifestValidationResult {
  const issues: string[] = [];
  const root = isRecord(manifest) ? manifest : null;
  if (!root) return { ok: false, issues: ["render manifest must be a JSON object"] };

  requireEqual(root.schema_version, 2, "schema_version", issues);
  requireString(root.project_id, "project_id", issues);
  requireString(root.workflow_run_id, "workflow_run_id", issues);
  requireString(root.status, "status", issues);

  const evidenceStatus = requireRecord(root.evidence_status, "evidence_status", issues);
  if (evidenceStatus) {
    requireBoolean(evidenceStatus.media_export_passed, "evidence_status.media_export_passed", issues);
    requireBoolean(evidenceStatus.live_imagegen_passed, "evidence_status.live_imagegen_passed", issues);
    requireBoolean(evidenceStatus.ai_authored_frames_passed, "evidence_status.ai_authored_frames_passed", issues);
    requireStringOrNull(evidenceStatus.review_decision_source, "evidence_status.review_decision_source", issues);
    const strict = requireRecord(evidenceStatus.strict, "evidence_status.strict", issues);
    if (strict) {
      requireBoolean(strict.production_default, "evidence_status.strict.production_default", issues);
      requireBoolean(strict.allow_cached_imagegen, "evidence_status.strict.allow_cached_imagegen", issues);
      requireBoolean(strict.allow_fallback_frames, "evidence_status.strict.allow_fallback_frames", issues);
      requireBoolean(strict.allow_auto_lock_image_assets, "evidence_status.strict.allow_auto_lock_image_assets", issues);
    }
  }

  requireEvidence(root.inputs, "inputs.active_music_take_mp3", issues, "active_music_take_mp3");
  requireEvidence(root.inputs, "inputs.lyrics_md", issues, "lyrics_md");
  requireEvidence(root.audio_analysis, "audio_analysis.beat_grid", issues, "beat_grid");
  requireEvidence(root.audio_analysis, "audio_analysis.onset_events", issues, "onset_events");
  requireEvidence(root.audio_analysis, "audio_analysis.energy_curve", issues, "energy_curve");
  requireEvidence(root.word_alignment, "word_alignment.lyric_word_timing", issues, "lyric_word_timing");
  requireEvidence(root.word_alignment, "word_alignment.alignment_report", issues, "alignment_report");
  requireEvidence(root.image_generation, "image_generation.image_assets", issues, "image_assets");
  requireEvidence(root.html_video, "html_video.content_graph", issues, "content_graph");
  requireEvidence(root.html_video, "html_video.frame_contracts", issues, "frame_contracts");
  requireEvidence(root.html_video, "html_video.agent_context", issues, "agent_context");
  requireEvidence(root.render, "render.visual_silent_mp4", issues, "visual_silent_mp4");
  requireEvidence(root.mux, "mux.final_mp4", issues, "final_mp4");

  const htmlVideo = isRecord(root.html_video) ? root.html_video : null;
  if (!Array.isArray(htmlVideo?.frames) || htmlVideo.frames.length === 0) {
    issues.push("html_video.frames must contain frame evidence");
  } else {
    htmlVideo.frames.forEach((frame, index) => {
      if (!isEvidence(frame)) issues.push(`html_video.frames[${index}] must include path and sha256`);
    });
  }

  const qa = requireRecord(root.qa, "qa", issues);
  if (qa) {
    requireNumber(qa.duration_drift_sec, "qa.duration_drift_sec", issues);
    requireBoolean(qa.final_has_single_audio_stream, "qa.final_has_single_audio_stream", issues);
  }

  return { ok: issues.length === 0, issues };
}

function requireEvidence(parent: unknown, label: string, issues: string[], key: string): void {
  const parentRecord = isRecord(parent) ? parent : null;
  if (!parentRecord || !isEvidence(parentRecord[key])) issues.push(`${label} must include path and sha256`);
}

function isEvidence(value: unknown): value is { path: string; sha256: string } {
  return isRecord(value) && typeof value.path === "string" && value.path.length > 0 && typeof value.sha256 === "string" && value.sha256.length > 0;
}

function requireRecord(value: unknown, label: string, issues: string[]): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  issues.push(`${label} must be an object`);
  return null;
}

function requireString(value: unknown, label: string, issues: string[]): void {
  if (typeof value !== "string" || value.length === 0) issues.push(`${label} must be a non-empty string`);
}

function requireStringOrNull(value: unknown, label: string, issues: string[]): void {
  if (value !== null && typeof value !== "string") issues.push(`${label} must be a string or null`);
}

function requireBoolean(value: unknown, label: string, issues: string[]): void {
  if (typeof value !== "boolean") issues.push(`${label} must be a boolean`);
}

function requireNumber(value: unknown, label: string, issues: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) issues.push(`${label} must be a finite number`);
}

function requireEqual(value: unknown, expected: unknown, label: string, issues: string[]): void {
  if (value !== expected) issues.push(`${label} must be ${expected}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
