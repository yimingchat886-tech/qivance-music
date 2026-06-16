import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { MediaE2ERatio } from "../src/lib/media-e2e/types.ts";

const FIXTURES: MediaE2ERatio[] = ["portrait-9x16", "landscape-16x9", "square-1x1"];

for (const ratio of FIXTURES) {
  test(`validates committed ${ratio} WhisperX seed word timing`, async () => {
    const timingPath = path.join("fixtures", "media-e2e-v2", ratio, "lyric_word_timing.json");
    const timing = JSON.parse(await readFile(timingPath, "utf8")) as {
      backend: string;
      words: Array<{ word_id: string; text: string; start_sec: number; end_sec: number }>;
    };

    assert.equal(timing.backend, "whisperx");
    assert.ok(timing.words.length > 0);
    assert.ok(timing.words.every((word) => word.word_id && word.text && word.end_sec >= word.start_sec));
  });
}
