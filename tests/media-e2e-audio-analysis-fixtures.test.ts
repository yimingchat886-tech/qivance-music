import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateAudioAnalysisArtifacts } from "../src/lib/audio-analysis/librosa-runner.ts";
import type { MediaE2ERatio } from "../src/lib/media-e2e/types.ts";

const FIXTURES: Array<{ ratio: MediaE2ERatio; durationSec: number }> = [
  { ratio: "portrait-9x16", durationSec: 24 },
  { ratio: "landscape-16x9", durationSec: 28 },
  { ratio: "square-1x1", durationSec: 32 },
];

for (const fixture of FIXTURES) {
  test(`validates committed ${fixture.ratio} librosa artifacts`, async () => {
    const root = path.join("fixtures", "media-e2e-v2", fixture.ratio, "audio_analysis");
    const beatGrid = JSON.parse(await readFile(path.join(root, "beat_grid.json"), "utf8"));
    const onsetEvents = JSON.parse(await readFile(path.join(root, "onset_events.json"), "utf8"));
    const energyCurve = JSON.parse(await readFile(path.join(root, "energy_curve.json"), "utf8"));

    const result = validateAudioAnalysisArtifacts({
      expectedDurationSec: fixture.durationSec,
      beatGrid,
      onsetEvents,
      energyCurve,
    });

    assert.equal(result.ok, true, result.issues.join("\n"));
  });
}
