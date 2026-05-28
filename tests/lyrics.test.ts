import assert from "node:assert/strict";
import test from "node:test";
import { parseLyrics } from "../src/lib/lyrics.ts";

test("parses MiniMax-style lyric sections from markdown", () => {
  const parsed = parseLyrics(`[Intro]\n宇宙开始轻轻响\n\n[Verse]\n原子排队发光\n电子跳上能级台阶\n\n[Hook]\n光谱告诉你答案`);

  assert.equal(parsed.sections.length, 3);
  assert.deepEqual(
    parsed.sections.map((section) => section.label),
    ["Intro", "Verse", "Hook"],
  );
  assert.deepEqual(parsed.sections[1].lines, ["原子排队发光", "电子跳上能级台阶"]);
});

test("falls back to a single verse when lyrics contain no section labels", () => {
  const parsed = parseLyrics("第一句\n第二句");

  assert.equal(parsed.sections.length, 1);
  assert.equal(parsed.sections[0].label, "Verse");
  assert.deepEqual(parsed.sections[0].lines, ["第一句", "第二句"]);
});

