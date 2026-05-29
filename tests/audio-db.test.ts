import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { materializeAudioAsset, saveAudioAsset } from "../src/lib/audio-db.ts";

test("stores uploaded audio as a SQLite BLOB and materializes it for ffmpeg", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-audio-db-"));
  const audio = Buffer.from([0, 1, 2, 3, 255, 128, 64]);

  const saved = await saveAudioAsset(storageRoot, {
    filename: "accepted-take.mp3",
    mimeType: "audio/mpeg",
    data: audio,
  });
  const materialized = await materializeAudioAsset(
    storageRoot,
    saved.id,
    path.join(storageRoot, "project_audio"),
    "minimax_rap_raw",
  );

  await stat(path.join(storageRoot, "qivance_audio.sqlite"));
  assert.match(saved.id, /^audio_/);
  assert.equal(saved.byteLength, audio.byteLength);
  assert.equal(materialized.filename, "minimax_rap_raw.mp3");
  assert.deepEqual(await readFile(materialized.path), audio);
});
