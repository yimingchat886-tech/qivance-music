import assert from "node:assert/strict";
import test from "node:test";
import { buildLyricsLineMap } from "../src/lib/chat-dialogue/lyrics-line-map.ts";
import { buildSpeakerAttribution, validateSpeakerAttribution } from "../src/lib/chat-dialogue/speaker-attribution.ts";

test("attributes explicit question and answer prefixes", () => {
  const lineMap = buildLyricsLineMap({
    lyricsText: "问：为什么模型乱回答？\n答：因为上下文没抓牢\n",
  });
  const attribution = buildSpeakerAttribution({ lineMap });

  assert.deepEqual(attribution.assignments.map((assignment) => assignment.speaker), ["questioner", "answerer"]);
  assert.deepEqual(attribution.assignments.map((assignment) => assignment.side), ["left", "right"]);
  assert.equal(attribution.low_confidence_count, 0);
  assert.equal(validateSpeakerAttribution({ lineMap, speakerAttribution: attribution }).ok, true);
});

test("handles ambiguous A prefix deterministically", () => {
  const explicitQa = buildSpeakerAttribution({
    lineMap: buildLyricsLineMap({ lyricsText: "Q: What now?\nA: Answer now\n" }),
  });
  assert.deepEqual(explicitQa.assignments.map((assignment) => assignment.speaker), ["questioner", "answerer"]);

  const roleA = buildSpeakerAttribution({
    lineMap: buildLyricsLineMap({ lyricsText: "A: I open the dialogue\nB: I answer the bar\n" }),
  });
  assert.deepEqual(roleA.assignments.map((assignment) => assignment.speaker), ["questioner", "answerer"]);
  assert.equal(roleA.assignments[0]?.attribution_source, "explicit_role_prefix");
});

test("falls back by question punctuation and alternation", () => {
  const lineMap = buildLyricsLineMap({
    lyricsText: "为什么要这样？\n因为节奏要对齐\n下一句继续\n",
  });
  const attribution = buildSpeakerAttribution({ lineMap });

  assert.deepEqual(attribution.assignments.map((assignment) => assignment.speaker), ["questioner", "answerer", "questioner"]);
  assert.equal(attribution.low_confidence_count, 2);
});
