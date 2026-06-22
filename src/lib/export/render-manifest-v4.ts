export type RenderManifestV4EvidenceRef = {
  path: string;
  sha256: string;
};

export type RenderManifestV4 = {
  schema_version: 4;
  mode: "production" | "diagnostic";
  chain: {
    id: "chat_dialogue_mv";
    run_id: string;
    conversation_plan: RenderManifestV4EvidenceRef;
    frame_contracts?: RenderManifestV4EvidenceRef;
    runtime_timeline?: RenderManifestV4EvidenceRef;
    runtime_html?: RenderManifestV4EvidenceRef;
    browser_render_evidence?: RenderManifestV4EvidenceRef;
    render_mode: "browser_recording" | "static_microframes";
    fps: number;
  };
  inputs: {
    lyrics: RenderManifestV4EvidenceRef;
    audio: RenderManifestV4EvidenceRef;
    timing: Record<string, RenderManifestV4EvidenceRef>;
  };
  outputs: {
    visual: RenderManifestV4EvidenceRef;
    final: RenderManifestV4EvidenceRef;
  };
  qa: {
    ffprobe: Record<string, unknown>;
    duration_drift_ms: number;
    audio_stream_count: number;
  };
  production_gates: {
    fallback_frames_used: boolean;
    diagnostic_only: boolean;
    remote_resources_used: boolean;
  };
};

export type BuildRenderManifestV4Input = {
  mode?: "production" | "diagnostic";
  runId: string;
  conversationPlan: RenderManifestV4EvidenceRef;
  frameContracts?: RenderManifestV4EvidenceRef;
  runtimeTimeline?: RenderManifestV4EvidenceRef;
  runtimeHtml?: RenderManifestV4EvidenceRef;
  browserRenderEvidence?: RenderManifestV4EvidenceRef;
  renderMode?: "browser_recording" | "static_microframes";
  fps?: number;
  lyrics: RenderManifestV4EvidenceRef;
  audio: RenderManifestV4EvidenceRef;
  timing: Record<string, RenderManifestV4EvidenceRef>;
  visual: RenderManifestV4EvidenceRef;
  final: RenderManifestV4EvidenceRef;
  ffprobe?: Record<string, unknown>;
  durationDriftMs: number;
  audioStreamCount: number;
  fallbackFramesUsed?: boolean;
  diagnosticOnly?: boolean;
  remoteResourcesUsed?: boolean;
};

export function buildRenderManifestV4(input: BuildRenderManifestV4Input): RenderManifestV4 {
  const renderMode = input.renderMode ?? "static_microframes";
  return {
    schema_version: 4,
    mode: input.mode ?? "production",
    chain: {
      id: "chat_dialogue_mv",
      run_id: input.runId,
      conversation_plan: input.conversationPlan,
      ...(input.frameContracts ? { frame_contracts: input.frameContracts } : {}),
      ...(input.runtimeTimeline ? { runtime_timeline: input.runtimeTimeline } : {}),
      ...(input.runtimeHtml ? { runtime_html: input.runtimeHtml } : {}),
      ...(input.browserRenderEvidence ? { browser_render_evidence: input.browserRenderEvidence } : {}),
      render_mode: renderMode,
      fps: input.fps ?? (renderMode === "browser_recording" ? 60 : 30),
    },
    inputs: {
      lyrics: input.lyrics,
      audio: input.audio,
      timing: input.timing,
    },
    outputs: {
      visual: input.visual,
      final: input.final,
    },
    qa: {
      ffprobe: input.ffprobe ?? {},
      duration_drift_ms: input.durationDriftMs,
      audio_stream_count: input.audioStreamCount,
    },
    production_gates: {
      fallback_frames_used: input.fallbackFramesUsed ?? false,
      diagnostic_only: input.diagnosticOnly ?? false,
      remote_resources_used: input.remoteResourcesUsed ?? false,
    },
  };
}

export function validateRenderManifestV4(manifest: RenderManifestV4): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (manifest.schema_version !== 4) issues.push("render_manifest.schema_version must be 4");
  if (manifest.chain.id !== "chat_dialogue_mv") issues.push("render_manifest.chain.id must be chat_dialogue_mv");
  if (!manifest.chain.run_id) issues.push("render_manifest.chain.run_id is required");
  requireEvidence(manifest.chain.conversation_plan, "chain.conversation_plan", issues);
  if (manifest.chain.render_mode === "browser_recording") {
    requireEvidence(manifest.chain.runtime_timeline, "chain.runtime_timeline", issues);
    requireEvidence(manifest.chain.runtime_html, "chain.runtime_html", issues);
    requireEvidence(manifest.chain.browser_render_evidence, "chain.browser_render_evidence", issues);
    if (manifest.chain.fps !== 60) issues.push("chain.fps must be 60 for browser_recording");
  } else if (manifest.chain.render_mode === "static_microframes") {
    requireEvidence(manifest.chain.frame_contracts, "chain.frame_contracts", issues);
  } else {
    issues.push("chain.render_mode is invalid");
  }
  requireEvidence(manifest.inputs.lyrics, "inputs.lyrics", issues);
  requireEvidence(manifest.inputs.audio, "inputs.audio", issues);
  requireEvidence(manifest.outputs.visual, "outputs.visual", issues);
  requireEvidence(manifest.outputs.final, "outputs.final", issues);
  if (!manifest.outputs.final.path.startsWith("exports/chat_dialogue_mv/")) {
    issues.push("outputs.final.path must stay under exports/chat_dialogue_mv/");
  }
  if (!manifest.outputs.visual.path.startsWith("exports/chat_dialogue_mv/")) {
    issues.push("outputs.visual.path must stay under exports/chat_dialogue_mv/");
  }
  if (manifest.qa.audio_stream_count !== 1) issues.push("qa.audio_stream_count must be exactly 1");
  if (Math.abs(manifest.qa.duration_drift_ms) > 150) issues.push("qa.duration_drift_ms must be <= 150ms");
  if (manifest.mode === "production") {
    if (manifest.production_gates.fallback_frames_used) issues.push("production fallback_frames_used must be false");
    if (manifest.production_gates.diagnostic_only) issues.push("production diagnostic_only must be false");
    if (manifest.production_gates.remote_resources_used) issues.push("production remote_resources_used must be false");
  }
  return { ok: issues.length === 0, issues };
}

function requireEvidence(ref: RenderManifestV4EvidenceRef | undefined, label: string, issues: string[]): void {
  if (!ref || typeof ref.path !== "string" || ref.path.length === 0) issues.push(`${label}.path is required`);
  if (!ref || typeof ref.sha256 !== "string" || ref.sha256.length === 0) issues.push(`${label}.sha256 is required`);
}
