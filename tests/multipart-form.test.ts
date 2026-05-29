import assert from "node:assert/strict";
import test from "node:test";
import { parseMultipartForm } from "../src/lib/multipart-form.ts";

test("parses text fields and binary audio files from multipart form data", () => {
  const boundary = "qivance-boundary";
  const audio = Buffer.from([0, 1, 2, 255, 128, 64]);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="topic"\r\n\r\n恒星发光\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="videoSize"\r\n\r\n1920x1080\r\n`),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="rawAudioFile"; filename="take.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
    ),
    audio,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const form = parseMultipartForm(`multipart/form-data; boundary=${boundary}`, body);

  assert.equal(form.fields.get("topic"), "恒星发光");
  assert.equal(form.fields.get("videoSize"), "1920x1080");
  assert.equal(form.files.get("rawAudioFile")?.filename, "take.wav");
  assert.equal(form.files.get("rawAudioFile")?.mimeType, "audio/wav");
  assert.deepEqual(form.files.get("rawAudioFile")?.data, audio);
});
