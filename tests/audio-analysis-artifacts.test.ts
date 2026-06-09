import test from "node:test";
import assert from "node:assert/strict";
import { validateAudioAnalysisArtifacts } from "../src/lib/audio-analysis/librosa-runner.ts";

test("accepts beat, onset, and energy artifacts matching duration", () => {
  const result = validateAudioAnalysisArtifacts({
    expectedDurationSec: 30,
    beatGrid: {
      schema_version: 1,
      duration_sec: 30.02,
      tempo_bpm: 92,
      tempo_candidates: [92],
      beats: [{ index: 0, time_sec: 0.5, confidence: 0.8 }],
    },
    onsetEvents: {
      schema_version: 1,
      duration_sec: 30.01,
      events: [{ time_sec: 0.51, strength: 0.9 }],
    },
    energyCurve: {
      schema_version: 1,
      duration_sec: 30,
      frame_hop_sec: 0.1,
      points: [{ time_sec: 0, rms: 0.1, normalized_energy: 0.5 }],
      low_energy_ranges: [],
    },
  });

  assert.equal(result.ok, true);
});

test("rejects artifacts drifting more than 150ms from expected duration", () => {
  const result = validateAudioAnalysisArtifacts({
    expectedDurationSec: 30,
    beatGrid: {
      schema_version: 1,
      duration_sec: 30.151,
      tempo_bpm: 92,
      tempo_candidates: [92],
      beats: [],
    },
    onsetEvents: { schema_version: 1, duration_sec: 30, events: [] },
    energyCurve: {
      schema_version: 1,
      duration_sec: 30,
      frame_hop_sec: 0.1,
      points: [],
      low_energy_ranges: [],
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /150ms/);
});

test("rejects out-of-range timing evidence", () => {
  const result = validateAudioAnalysisArtifacts({
    expectedDurationSec: 30,
    beatGrid: {
      schema_version: 1,
      duration_sec: 30,
      tempo_bpm: 92,
      tempo_candidates: [92],
      beats: [{ index: 0, time_sec: 31, confidence: 0.8 }],
    },
    onsetEvents: { schema_version: 1, duration_sec: 30, events: [] },
    energyCurve: {
      schema_version: 1,
      duration_sec: 30,
      frame_hop_sec: 0.1,
      points: [],
      low_energy_ranges: [],
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /out of range/);
});
