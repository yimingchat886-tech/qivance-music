import test from "node:test";
import assert from "node:assert/strict";
import { evaluateWordAlignmentQuality } from "../src/lib/word-alignment/quality-gate.ts";

test("passes medium strict production gate", () => {
  const result = evaluateWordAlignmentQuality({
    totalWords: 100,
    alignedWords: 90,
    lowConfidenceWords: 10,
    unmatchedWords: 5,
    sectionDurationCoverage: 0.99,
    sectionBoundaryEvidenceDriftSec: 0.32,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("fails when word coverage is below 85 percent", () => {
  const result = evaluateWordAlignmentQuality({
    totalWords: 100,
    alignedWords: 84,
    lowConfidenceWords: 10,
    unmatchedWords: 5,
    sectionDurationCoverage: 0.99,
    sectionBoundaryEvidenceDriftSec: 0.32,
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /word coverage/);
});
