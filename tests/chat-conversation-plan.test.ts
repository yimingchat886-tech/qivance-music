import assert from "node:assert/strict";
import test from "node:test";
import { buildConversationPlan, validateConversationPlan } from "../src/lib/chat-dialogue/conversation-plan.ts";
import { buildLineTimings } from "../src/lib/chat-dialogue/line-timing.ts";
import { buildLyricsLineMap } from "../src/lib/chat-dialogue/lyrics-line-map.ts";
import { buildSpeakerAttribution } from "../src/lib/chat-dialogue/speaker-attribution.ts";

test("builds production conversation plan from explicit line timing", () => {
  const lineMap = buildLyricsLineMap({ lyricsText: "问：hello world?\n答：answer now\n", lyricsSha256: "lyrics-sha" });
  const speakerAttribution = buildSpeakerAttribution({ lineMap });
  const sectionMap = sectionMapFixture();
  const lyricWordTiming = {
    words: [
      { line_id: "line_001", word: "hello", start_sec: 0.5, end_sec: 0.8 },
      { line_id: "line_001", word: "world", start_sec: 0.9, end_sec: 1.2 },
      { line_id: "line_002", word: "answer", start_sec: 1.5, end_sec: 1.8 },
      { line_id: "line_002", word: "now", start_sec: 1.9, end_sec: 2.2 },
    ],
  };

  const result = buildConversationPlan({
    lineMap,
    speakerAttribution,
    lyricWordTiming,
    sectionMap,
    lyricsSha256: "lyrics-sha",
    audioSha256: "audio-sha",
  });

  assert.deepEqual(result.issues, []);
  assert.ok(result.conversationPlan);
  assert.equal(result.conversationPlan.messages[0]?.raw_text, "问：hello world?");
  assert.equal(result.conversationPlan.messages[0]?.display_text, "hello world?");
  assert.equal(result.conversationPlan.messages[0]?.speaker, "questioner");
  assert.equal(result.conversationPlan.messages[1]?.section_id, "sec_001");
  assert.equal(validateConversationPlan({ conversationPlan: result.conversationPlan, lineMap, speakerAttribution }).ok, true);
});

test("blocks production plan without timing evidence", () => {
  const lineMap = buildLyricsLineMap({ lyricsText: "问：hello world?\n答：answer now\n" });
  const result = buildConversationPlan({
    lineMap,
    speakerAttribution: buildSpeakerAttribution({ lineMap }),
    sectionMap: sectionMapFixture(),
    lyricWordTiming: null,
  });

  assert.match(result.issues.join("\n"), /lyric_word_timing is required/);
});

test("uses diagnostic fallback only when allowed", () => {
  const lineMap = buildLyricsLineMap({ lyricsText: "问：hello world?\n答：answer now\n" });
  const timings = buildLineTimings({
    lineMap,
    sectionMap: sectionMapFixture(),
    lyricWordTiming: null,
    allowDiagnosticFallback: true,
  });

  assert.equal(timings.diagnosticFallbackUsed, true);
  assert.equal(timings.timings.length, 2);
  assert.equal(timings.timings[0]?.timing_source, "diagnostic_even_split");
});

function sectionMapFixture() {
  return {
    duration_sec: 4,
    sections: [
      { section_id: "sec_001", start_sec: 0, end_sec: 4 },
    ],
  };
}
