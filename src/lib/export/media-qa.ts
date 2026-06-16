import type { MediaProbe } from "./ffprobe.ts";

export function validateVisualAndFinalMedia(input: {
  visualProbe: MediaProbe;
  finalProbe: MediaProbe;
  expected: {
    durationSec: number;
    fps: number;
    resolution: { width: number; height: number };
  };
}): { ok: boolean; issues: string[] } {
  const issues: string[] = [];

  validateVideoProbe("visual", input.visualProbe, input.expected, false, issues);
  validateVideoProbe("final", input.finalProbe, input.expected, true, issues);

  if (input.finalProbe.audio?.codecName !== "aac") {
    issues.push(`final audio codec must be aac, got ${input.finalProbe.audio?.codecName ?? "none"}`);
  }
  if (input.finalProbe.audioStreamCount !== 1) {
    issues.push(`final audio stream count must be 1, got ${input.finalProbe.audioStreamCount}`);
  }
  return { ok: issues.length === 0, issues };
}

function validateVideoProbe(
  label: string,
  probe: MediaProbe,
  expected: { durationSec: number; fps: number; resolution: { width: number; height: number } },
  requireAudio: boolean,
  issues: string[],
): void {
  if (!probe.hasVideoStream) issues.push(`${label} must have a video stream`);
  if (probe.videoStreamCount !== 1) issues.push(`${label} video stream count must be 1, got ${probe.videoStreamCount}`);
  if (requireAudio && !probe.hasAudioStream) issues.push(`${label} must have an audio stream`);
  if (!requireAudio && probe.hasAudioStream) issues.push(`${label} visual_silent.mp4 must not have an audio stream`);
  if (probe.video?.width !== expected.resolution.width || probe.video?.height !== expected.resolution.height) {
    issues.push(`${label} resolution must be ${expected.resolution.width}x${expected.resolution.height}`);
  }
  if (Math.abs((probe.video?.fps ?? 0) - expected.fps) > 0.01) {
    issues.push(`${label} fps must be ${expected.fps}`);
  }
  if (Math.abs(probe.durationSec - expected.durationSec) > 0.15) {
    issues.push(`${label} duration drift exceeds 150ms`);
  }
}

