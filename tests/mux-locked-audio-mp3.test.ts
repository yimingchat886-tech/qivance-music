import test from "node:test";
import assert from "node:assert/strict";
import { buildMuxLockedAudioCommand } from "../src/lib/export/mux-locked-audio.ts";

test("builds mp3 to AAC mux command", () => {
  const args = buildMuxLockedAudioCommand({
    visualPath: "exports/visual_silent.mp4",
    audioPath: "audio/master/active_music_take.mp3",
    outputPath: "exports/final.mp4",
  });

  assert.deepEqual(args, [
    "-y",
    "-i", "exports/visual_silent.mp4",
    "-i", "audio/master/active_music_take.mp3",
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    "exports/final.mp4",
  ]);
});
