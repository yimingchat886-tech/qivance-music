import test from "node:test";
import assert from "node:assert/strict";
import { validateVisualAndFinalMedia } from "../src/lib/export/media-qa.ts";

test("accepts silent visual and AAC final matching expected media contract", () => {
  const result = validateVisualAndFinalMedia({
    visualProbe: {
      durationSec: 24.02,
      hasVideoStream: true,
      hasAudioStream: false,
      videoStreamCount: 1,
      audioStreamCount: 0,
      video: { codecName: "h264", width: 1080, height: 1920, fps: 30 },
    },
    finalProbe: {
      durationSec: 24.01,
      hasVideoStream: true,
      hasAudioStream: true,
      videoStreamCount: 1,
      audioStreamCount: 1,
      video: { codecName: "h264", width: 1080, height: 1920, fps: 30 },
      audio: { codecName: "aac", durationSec: 24.01 },
    },
    expected: { durationSec: 24, fps: 30, resolution: { width: 1080, height: 1920 } },
  });

  assert.equal(result.ok, true);
});

test("rejects drift, wrong resolution, visual audio, and non-AAC final audio", () => {
  const result = validateVisualAndFinalMedia({
    visualProbe: {
      durationSec: 24.3,
      hasVideoStream: true,
      hasAudioStream: true,
      videoStreamCount: 1,
      audioStreamCount: 1,
      video: { codecName: "h264", width: 720, height: 1280, fps: 24 },
    },
    finalProbe: {
      durationSec: 24,
      hasVideoStream: true,
      hasAudioStream: true,
      videoStreamCount: 1,
      audioStreamCount: 1,
      video: { codecName: "h264", width: 1080, height: 1920, fps: 30 },
      audio: { codecName: "mp3", durationSec: 24 },
    },
    expected: { durationSec: 24, fps: 30, resolution: { width: 1080, height: 1920 } },
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /visual_silent\.mp4 must not have an audio stream/);
  assert.match(result.issues.join("\n"), /final audio codec must be aac/);
});
