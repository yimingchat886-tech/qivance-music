import assert from "node:assert/strict";
import test from "node:test";
import { buildRenderManifestV4, validateRenderManifestV4, type RenderManifestV4EvidenceRef } from "../src/lib/export/render-manifest-v4.ts";

test("validates production chat dialogue manifest evidence", () => {
  const manifest = buildRenderManifestV4({
    runId: "run_001",
    conversationPlan: evidence("data/chains/chat_dialogue_mv/conversation_plan.json"),
    frameContracts: evidence("data/chains/chat_dialogue_mv/frame_contracts.json"),
    lyrics: evidence("lyrics.md"),
    audio: evidence("active_music_take.mp3"),
    timing: {
      lyric_word_timing: evidence("data/timing/lyric_word_timing.json"),
      section_map: evidence("data/timing/section_map.json"),
    },
    visual: evidence("exports/chat_dialogue_mv/visual.mp4"),
    final: evidence("exports/chat_dialogue_mv/final.mp4"),
    durationDriftMs: 12,
    audioStreamCount: 1,
  });

  const validation = validateRenderManifestV4(manifest);

  assert.equal(validation.ok, true, validation.issues.join("\n"));
  assert.equal(manifest.schema_version, 4);
  assert.equal(manifest.chain.id, "chat_dialogue_mv");
});

test("blocks production manifest with fallback, diagnostic, remote, or wrong output path", () => {
  const manifest = buildRenderManifestV4({
    runId: "run_001",
    conversationPlan: evidence("data/chains/chat_dialogue_mv/conversation_plan.json"),
    frameContracts: evidence("data/chains/chat_dialogue_mv/frame_contracts.json"),
    lyrics: evidence("lyrics.md"),
    audio: evidence("active_music_take.mp3"),
    timing: {},
    visual: evidence("exports/visual.mp4"),
    final: evidence("exports/final.mp4"),
    durationDriftMs: 200,
    audioStreamCount: 2,
    fallbackFramesUsed: true,
    diagnosticOnly: true,
    remoteResourcesUsed: true,
  });

  const validation = validateRenderManifestV4(manifest);
  const issues = validation.issues.join("\n");

  assert.equal(validation.ok, false);
  assert.match(issues, /outputs.final.path/);
  assert.match(issues, /outputs.visual.path/);
  assert.match(issues, /audio_stream_count/);
  assert.match(issues, /duration_drift_ms/);
  assert.match(issues, /fallback_frames_used/);
  assert.match(issues, /diagnostic_only/);
  assert.match(issues, /remote_resources_used/);
});

function evidence(path: string): RenderManifestV4EvidenceRef {
  return { path, sha256: `${path}-sha` };
}
