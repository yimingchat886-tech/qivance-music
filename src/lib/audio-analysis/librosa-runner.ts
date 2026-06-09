import type { BeatGrid, EnergyCurve, OnsetEvents } from "./types.ts";

const MAX_DURATION_DRIFT_SEC = 0.15;

export function validateAudioAnalysisArtifacts(input: {
  expectedDurationSec: number;
  beatGrid: BeatGrid;
  onsetEvents: OnsetEvents;
  energyCurve: EnergyCurve;
}): { ok: boolean; issues: string[] } {
  const issues: string[] = [];

  for (const [name, duration] of [
    ["beat_grid", input.beatGrid.duration_sec],
    ["onset_events", input.onsetEvents.duration_sec],
    ["energy_curve", input.energyCurve.duration_sec],
  ] as const) {
    if (Math.abs(duration - input.expectedDurationSec) > MAX_DURATION_DRIFT_SEC) {
      issues.push(`${name} duration differs from mp3 duration by more than 150ms`);
    }
  }

  for (const beat of input.beatGrid.beats) {
    if (isOutOfRange(beat.time_sec, input.expectedDurationSec)) {
      issues.push(`beat ${beat.index} out of range`);
    }
  }

  for (const event of input.onsetEvents.events) {
    if (isOutOfRange(event.time_sec, input.expectedDurationSec)) {
      issues.push(`onset ${event.time_sec} out of range`);
    }
  }

  for (const point of input.energyCurve.points) {
    if (isOutOfRange(point.time_sec, input.expectedDurationSec)) {
      issues.push(`energy point ${point.time_sec} out of range`);
    }
  }

  return { ok: issues.length === 0, issues };
}

function isOutOfRange(timeSec: number, durationSec: number): boolean {
  return timeSec < 0 || timeSec > durationSec;
}
