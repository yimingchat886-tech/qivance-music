import test from "node:test";
import assert from "node:assert/strict";
import { buildSectionMapFromEvidence } from "../src/lib/section-map/section-map-builder.ts";

test("builds section map from scenes and timing evidence", () => {
  const map = buildSectionMapFromEvidence({
    durationSec: 30,
    scenes: [
      { scene_id: "scene_001_hook", section_ids: ["sec_001_hook"], start_sec: 0, end_sec: 8 },
      { scene_id: "scene_002_body", section_ids: ["sec_002_body"], start_sec: 8, end_sec: 22 },
      { scene_id: "scene_003_outro", section_ids: ["sec_003_outro"], start_sec: 22, end_sec: 30 },
    ],
    words: [
      { word_id: "w_000001", paragraph_id: "p_001", start_sec: 0.5, end_sec: 1.0 },
      { word_id: "w_000002", paragraph_id: "p_002", start_sec: 10, end_sec: 10.5 },
      { word_id: "w_000003", paragraph_id: "p_003", start_sec: 24, end_sec: 24.5 },
    ],
    beats: [
      { index: 0, time_sec: 0 },
      { index: 1, time_sec: 8 },
      { index: 2, time_sec: 22 },
    ],
  });

  assert.equal(map.sections.length, 3);
  assert.equal(map.sections[0]?.section_id, "sec_001_hook");
  assert.equal(map.sections[0]?.word_range.start_word_id, "w_000001");
  assert.equal(map.sections[2]?.beat_range.start_index, 2);
});
