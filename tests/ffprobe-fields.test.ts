import test from "node:test";
import assert from "node:assert/strict";
import { parseFfprobeJson } from "../src/lib/export/ffprobe.ts";

test("parses stream counts and codec names from ffprobe json", () => {
  const probe = parseFfprobeJson(JSON.stringify({
    format: { duration: "30.04" },
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, r_frame_rate: "30/1" },
      { codec_type: "audio", codec_name: "aac", duration: "30.01" },
    ],
  }));

  assert.equal(probe.videoStreamCount, 1);
  assert.equal(probe.audioStreamCount, 1);
  assert.equal(probe.video?.codecName, "h264");
  assert.equal(probe.audio?.codecName, "aac");
});
