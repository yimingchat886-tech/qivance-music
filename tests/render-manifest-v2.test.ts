import test from "node:test";
import assert from "node:assert/strict";
import { buildRenderManifestV2, validateRenderManifestV2 } from "../src/lib/export/render-manifest-v2.ts";

test("builds a V2 manifest with required evidence sections", () => {
  const manifest = buildRenderManifestV2({
    projectId: "media_e2e_v2_portrait_9x16",
    aspectRatio: "9:16",
    resolution: { width: 1080, height: 1920 },
    fps: 30,
    workflowRunId: "run_001",
    status: "passed",
  });

  assert.equal(manifest.schema_version, 2);
  assert.equal(manifest.word_alignment.backend, "whisperx");
  assert.equal(manifest.word_alignment.metrics.word_coverage, null);
  assert.equal(manifest.mux.source_audio_codec, "mp3");
  assert.equal(manifest.mux.final_audio_codec, "aac");
});

test("validates complete V2 manifest evidence", () => {
  const manifest = completeManifest();
  const validation = validateRenderManifestV2(manifest);

  assert.equal(validation.ok, true);
});

test("rejects V2 manifests without frame hash evidence", () => {
  const manifest = completeManifest();
  manifest.html_video.frames = [];

  const validation = validateRenderManifestV2(manifest);

  assert.equal(validation.ok, false);
  assert.match(validation.issues.join("\n"), /html_video\.frames/);
});

function completeManifest(): any {
  const file = (name: string) => ({ path: `/tmp/${name}`, sha256: `${name}-hash` });
  return {
    schema_version: 2,
    project_id: "media_e2e_v2_portrait_9x16",
    aspect_ratio: "9:16",
    resolution: { width: 1080, height: 1920 },
    fps: 30,
    workflow_run_id: "run_001",
    status: "passed",
    evidence_status: {
      media_export_passed: true,
      live_imagegen_passed: true,
      ai_authored_frames_passed: true,
      strict: {
        production_default: true,
        allow_cached_imagegen: false,
        allow_fallback_frames: false,
        allow_auto_lock_image_assets: false,
      },
      review_decision_source: "file",
    },
    steps: [],
    inputs: { active_music_take_mp3: file("audio.mp3"), lyrics_md: file("lyrics.md") },
    audio_analysis: { beat_grid: file("beat_grid.json"), onset_events: file("onset_events.json"), energy_curve: file("energy_curve.json") },
    word_alignment: { backend: "whisperx", lyric_word_timing: file("lyric_word_timing.json"), alignment_report: file("alignment_report.json") },
    image_generation: { image_assets: file("image_assets.json") },
    html_video: { content_graph: file("content-graph.json"), frame_contracts: file("contracts.json"), agent_context: file("agent_context.json"), frames: [file("frame.html")] },
    render: { duration_mode: "explicit", visual_silent_mp4: file("visual.mp4") },
    mux: { source_audio_codec: "mp3", final_audio_codec: "aac", final_mp4: file("final.mp4") },
    qa: { duration_drift_sec: 0.04, final_has_single_audio_stream: true },
    diagnostics: [],
  };
}
