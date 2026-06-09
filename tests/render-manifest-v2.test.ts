import test from "node:test";
import assert from "node:assert/strict";
import { buildRenderManifestV2 } from "../src/lib/export/render-manifest-v2.ts";

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
