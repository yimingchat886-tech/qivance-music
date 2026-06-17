export type RenderManifestV6EvidenceRef = {
  path: string;
  sha256: string;
};

export type RenderManifestV6 = {
  schema_version: 6;
  mode: "production";
  chain: {
    id: "video_chain";
    run_id: string;
    animation_plan: RenderManifestV6EvidenceRef;
    frame_contracts: RenderManifestV6EvidenceRef;
  };
  inputs: {
    lyrics: RenderManifestV6EvidenceRef;
    audio: RenderManifestV6EvidenceRef;
    background_video: RenderManifestV6EvidenceRef & {
      audio_policy: "ignore_source_audio";
      ffprobe: Record<string, unknown>;
    };
    timing: Record<string, RenderManifestV6EvidenceRef>;
  };
  outputs: {
    visual: RenderManifestV6EvidenceRef;
    final: RenderManifestV6EvidenceRef;
  };
  qa: {
    ffprobe: Record<string, unknown>;
    duration_drift_ms: number;
    audio_stream_count: number;
    final_audio_source: "active_music_take.mp3";
  };
  production_gates: {
    fallback_frames_used: false;
    diagnostic_only: false;
    remote_resources_used: false;
    html_video_agent_required: true;
  };
};

export type RenderManifestV6ValidationResult = {
  ok: boolean;
  issues: string[];
};

const SHA256_HEX = /^[a-f0-9]{64}$/;

export function validateRenderManifestV6(manifest: unknown): RenderManifestV6ValidationResult {
  const issues: string[] = [];
  if (!isRecord(manifest)) return { ok: false, issues: ["render_manifest must be an object"] };

  if (manifest.schema_version !== 6) issues.push("render_manifest.schema_version must be 6");
  if (manifest.mode !== "production") issues.push("render_manifest.mode must be production");

  const chain = recordField(manifest, "chain", issues);
  if (chain) {
    if (chain.id !== "video_chain") issues.push("render_manifest.chain.id must be video_chain");
    if (typeof chain.run_id !== "string" || chain.run_id.length === 0) issues.push("render_manifest.chain.run_id is required");
    requireEvidence(chain.animation_plan, "chain.animation_plan", issues);
    requireEvidence(chain.frame_contracts, "chain.frame_contracts", issues);
  }

  const inputs = recordField(manifest, "inputs", issues);
  if (inputs) {
    requireEvidence(inputs.lyrics, "inputs.lyrics", issues);
    requireEvidence(inputs.audio, "inputs.audio", issues);
    const backgroundVideo = recordField(inputs, "background_video", issues);
    if (backgroundVideo) {
      requireEvidence(backgroundVideo, "inputs.background_video", issues);
      if (backgroundVideo.audio_policy !== "ignore_source_audio") {
        issues.push("inputs.background_video.audio_policy must be ignore_source_audio");
      }
    }
    const timing = recordField(inputs, "timing", issues);
    if (timing) {
      for (const [key, value] of Object.entries(timing)) {
        requireEvidence(value, `inputs.timing.${key}`, issues);
      }
    }
  }

  const outputs = recordField(manifest, "outputs", issues);
  if (outputs) {
    requireEvidence(outputs.visual, "outputs.visual", issues);
    requireEvidence(outputs.final, "outputs.final", issues);
    if (isRecord(outputs.visual) && typeof outputs.visual.path === "string" && !outputs.visual.path.startsWith("exports/video_chain/")) {
      issues.push("outputs.visual.path must stay under exports/video_chain/");
    }
    if (isRecord(outputs.final) && typeof outputs.final.path === "string" && !outputs.final.path.startsWith("exports/video_chain/")) {
      issues.push("outputs.final.path must stay under exports/video_chain/");
    }
  }

  const qa = recordField(manifest, "qa", issues);
  if (qa) {
    if (qa.final_audio_source !== "active_music_take.mp3") {
      issues.push("qa.final_audio_source must be active_music_take.mp3");
    }
    if (qa.audio_stream_count !== 1) issues.push("qa.audio_stream_count must be exactly 1");
    if (typeof qa.duration_drift_ms !== "number" || !Number.isFinite(qa.duration_drift_ms) || qa.duration_drift_ms < 0 || qa.duration_drift_ms > 150) {
      issues.push("qa.duration_drift_ms must be between 0 and 150ms");
    }
  }

  const productionGates = recordField(manifest, "production_gates", issues);
  if (productionGates) {
    if (productionGates.fallback_frames_used !== false) issues.push("production_gates.fallback_frames_used must be false");
    if (productionGates.diagnostic_only !== false) issues.push("production_gates.diagnostic_only must be false");
    if (productionGates.remote_resources_used !== false) issues.push("production_gates.remote_resources_used must be false");
    if (productionGates.html_video_agent_required !== true) issues.push("production_gates.html_video_agent_required must be true");
  }

  return { ok: issues.length === 0, issues };
}

function recordField(parent: Record<string, unknown>, key: string, issues: string[]): Record<string, unknown> | null {
  const value = parent[key];
  if (isRecord(value)) return value;
  issues.push(`${key} must be an object`);
  return null;
}

function requireEvidence(value: unknown, label: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${label} must include path and sha256`);
    return;
  }
  if (typeof value.path !== "string" || value.path.length === 0) {
    issues.push(`${label}.path is required`);
  }
  if (typeof value.sha256 !== "string" || !SHA256_HEX.test(value.sha256)) {
    issues.push(`${label}.sha256 must be 64 lowercase hex characters`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
