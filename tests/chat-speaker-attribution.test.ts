import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildLyricsLineMap } from "../src/lib/chat-dialogue/lyrics-line-map.ts";
import { buildSpeakerAttribution, validateSpeakerAttribution } from "../src/lib/chat-dialogue/speaker-attribution.ts";

test("attributes question punctuation to the right and non-questions to the left", () => {
  const lineMap = buildLyricsLineMap({
    lyricsText: "问：为什么模型乱回答？\n答：因为上下文没抓牢\n",
  });
  const attribution = buildSpeakerAttribution({ lineMap });

  assert.deepEqual(attribution.assignments.map((assignment) => assignment.speaker), ["questioner", "answerer"]);
  assert.deepEqual(attribution.assignments.map((assignment) => assignment.side), ["right", "left"]);
  assert.equal(attribution.low_confidence_count, 0);
  assert.equal(validateSpeakerAttribution({ lineMap, speakerAttribution: attribution }).ok, true);
});

test("does not use prefixes or question words without punctuation", () => {
  const explicitQa = buildSpeakerAttribution({
    lineMap: buildLyricsLineMap({ lyricsText: "Q: What now\nA: Answer now\n" }),
  });
  assert.deepEqual(explicitQa.assignments.map((assignment) => assignment.speaker), ["answerer", "answerer"]);
  assert.deepEqual(explicitQa.assignments.map((assignment) => assignment.side), ["left", "left"]);

  const questionWords = buildSpeakerAttribution({
    lineMap: buildLyricsLineMap({ lyricsText: "为什么要这样\n因为节奏要对齐\n" }),
  });
  assert.deepEqual(questionWords.assignments.map((assignment) => assignment.speaker), ["answerer", "answerer"]);
  assert.deepEqual(questionWords.assignments.map((assignment) => assignment.side), ["left", "left"]);
});

test("keeps consecutive non-question lyrics on the left", () => {
  const lineMap = buildLyricsLineMap({
    lyricsText: "为什么要这样？\n因为节奏要对齐\n下一句继续\n",
  });
  const attribution = buildSpeakerAttribution({ lineMap });

  assert.deepEqual(attribution.assignments.map((assignment) => assignment.speaker), ["questioner", "answerer", "answerer"]);
  assert.deepEqual(attribution.assignments.map((assignment) => assignment.side), ["right", "left", "left"]);
  assert.equal(attribution.low_confidence_count, 0);
});

test("classifies the real 2test lyrics by question punctuation only", async () => {
  const lyricsText = await readFile("projects/2test/歌词.md", "utf8").catch(() => readFile("projects/2test/lyrics.md", "utf8"));
  const lineMap = buildLyricsLineMap({
    lyricsText,
  });
  const attribution = buildSpeakerAttribution({ lineMap });
  const rightAssignments = attribution.assignments.filter((assignment) => assignment.side === "right");
  const lineById = new Map(lineMap.lines.map((line) => [line.line_id, line]));
  const expectedQuestionCount = lineMap.lines.filter((line) => line.display_text.includes("?") || line.display_text.includes("？")).length;

  assert.ok(lineMap.lines.length > 0);
  assert.equal(rightAssignments.length, expectedQuestionCount);
  assert.equal(validateSpeakerAttribution({ lineMap, speakerAttribution: attribution }).ok, true);
  for (const assignment of attribution.assignments) {
    const line = lineById.get(assignment.line_id)!;
    const isQuestion = line.display_text.includes("?") || line.display_text.includes("？");
    assert.equal(assignment.side, isQuestion ? "right" : "left");
  }
});
