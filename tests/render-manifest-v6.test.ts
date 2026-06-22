import assert from "node:assert/strict";
import test from "node:test";
import { validateRenderManifestV6, type RenderManifestV6, type RenderManifestV6EvidenceRef } from "../src/lib/export/render-manifest-v6.ts";

test("validates production video_chain render manifest v6", () => {
  const validation = validateRenderManifestV6(validManifest());

  assert.equal(validation.ok, true, validation.issues.join("\n"));
});

test("rejects invalid video_chain render manifest v6 gates and evidence", () => {
  const manifest = validManifest() as any;
  manifest.schema_version = 5;
  manifest.mode = "diagnostic";
  manifest.chain.id = "chat_dialogue_mv";
  manifest.chain.run_id = "";
  manifest.inputs.background_video.path = "";
  manifest.inputs.background_video.sha256 = "not-a-sha";
  manifest.inputs.background_video.audio_policy = "preserve_source_audio";
  manifest.outputs.visual.path = "exports/visual.mp4";
  manifest.qa.final_audio_source = "source_video.mp4";
  manifest.qa.audio_stream_count = 2;
  manifest.qa.duration_drift_ms = 151;
  manifest.production_gates.fallback_frames_used = true;
  manifest.production_gates.diagnostic_only = true;
  manifest.production_gates.remote_resources_used = true;
  manifest.production_gates.html_video_agent_required = false;

  const validation = validateRenderManifestV6(manifest);
  const issues = validation.issues.join("\n");

  assert.equal(validation.ok, false);
  assert.match(issues, /schema_version/);
  assert.match(issues, /mode/);
  assert.match(issues, /chain.id/);
  assert.match(issues, /run_id/);
  assert.match(issues, /inputs.background_video.path/);
  assert.match(issues, /inputs.background_video.sha256/);
  assert.match(issues, /audio_policy/);
  assert.match(issues, /outputs.visual.path/);
  assert.match(issues, /final_audio_source/);
  assert.match(issues, /audio_stream_count/);
  assert.match(issues, /duration_drift_ms/);
  assert.match(issues, /fallback_frames_used/);
  assert.match(issues, /diagnostic_only/);
  assert.match(issues, /remote_resources_used/);
  assert.match(issues, /html_video_agent_required/);
});

function validManifest(): RenderManifestV6 {
  return {
    schema_version: 6,
    mode: "production",
    chain: {
      id: "video_chain",
      run_id: "run_001",
      animation_plan: evidence("data/chains/video_chain/video_animation_plan.json"),
      frame_contracts: evidence("data/chains/video_chain/frame_contracts.json"),
    },
    inputs: {
      lyrics: evidence("lyrics.md"),
      audio: evidence("active_music_take.mp3"),
      background_video: {
        ...evidence("source_video.mp4"),
        audio_policy: "ignore_source_audio",
        ffprobe: {},
      },
      timing: {
        beat_grid: evidence("data/timing/beat_grid.json"),
        onset_events: evidence("data/timing/onset_events.json"),
        energy_curve: evidence("data/timing/energy_curve.json"),
        lyric_word_timing: evidence("data/timing/lyric_word_timing.json"),
        alignment_report: evidence("data/timing/alignment_report.json"),
        section_map: evidence("data/timing/section_map.json"),
      },
    },
    outputs: {
      visual: evidence("exports/video_chain/visual.mp4"),
      final: evidence("exports/video_chain/final.mp4"),
    },
    qa: {
      ffprobe: {},
      duration_drift_ms: 12,
      audio_stream_count: 1,
      final_audio_source: "active_music_take.mp3",
    },
    production_gates: {
      fallback_frames_used: false,
      diagnostic_only: false,
      remote_resources_used: false,
      html_video_agent_required: true,
    },
  };
}

function evidence(path: string): RenderManifestV6EvidenceRef {
  return { path, sha256: "a".repeat(64) };
}
