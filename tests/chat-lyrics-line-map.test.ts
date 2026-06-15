import assert from "node:assert/strict";
import test from "node:test";
import { buildLyricsLineMap, validateLyricsLineMap } from "../src/lib/chat-dialogue/lyrics-line-map.ts";

test("builds verbatim lyrics line map and excludes non-lyric lines", () => {
  const lineMap = buildLyricsLineMap({
    lyricsText: "# Title\n\n[Verse]\n问：为什么模型乱回答？\n答：因为上下文没抓牢\nA: I ask the system\nB: It answers back\n",
    lyricsSha256: "lyrics-sha",
  });

  assert.equal(lineMap.schema_version, 1);
  assert.equal(lineMap.lines.length, 4);
  assert.equal(lineMap.lines[0]?.raw_text, "问：为什么模型乱回答？");
  assert.equal(lineMap.lines[0]?.display_text, "为什么模型乱回答？");
  assert.equal(lineMap.lines[0]?.prefix, "问：");
  assert.deepEqual(lineMap.excluded_lines.map((line) => line.reason), ["markdown_heading", "blank_line", "section_label", "blank_line"]);
  assert.equal(validateLyricsLineMap(lineMap).ok, true);
});

test("rejects empty display text in lyric lines", () => {
  const lineMap = buildLyricsLineMap({ lyricsText: "问：\nreal lyric\n" });
  assert.equal(lineMap.lines.length, 1);
  assert.equal(lineMap.excluded_lines[0]?.reason, "section_label");
});
