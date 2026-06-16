import test from "node:test";
import assert from "node:assert/strict";
import { validateAlignmentOverride } from "../src/lib/word-alignment/alignment-override.ts";

test("allows timing-only overrides for specific word ranges", () => {
  const result = validateAlignmentOverride({
    schema_version: 1,
    override_author: "tester",
    reason: "low confidence around repeated chorus",
    created_at: "2026-06-09T00:00:00.000Z",
    changed_ranges: [
      {
        range_id: "override_001",
        word_ids: ["w_000001"],
        new_start_sec: 1,
        new_end_sec: 1.5,
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("rejects lyric text edits in manual timing override", () => {
  const result = validateAlignmentOverride({
    schema_version: 1,
    override_author: "tester",
    reason: "bad aligned word",
    created_at: "2026-06-09T00:00:00.000Z",
    changed_ranges: [
      {
        range_id: "override_001",
        word_ids: ["w_000001"],
        new_start_sec: 1,
        new_end_sec: 1.5,
        text: "changed lyric",
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /must not modify lyric text/);
});
