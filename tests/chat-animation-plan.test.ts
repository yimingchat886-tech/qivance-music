import assert from "node:assert/strict";
import test from "node:test";
import { buildChatAnimationPlan, validateChatAnimationPlan } from "../src/lib/chat-dialogue/chat-animation-plan.ts";
import { buildConversationPlan } from "../src/lib/chat-dialogue/conversation-plan.ts";
import { buildLyricsLineMap } from "../src/lib/chat-dialogue/lyrics-line-map.ts";
import { buildSpeakerAttribution } from "../src/lib/chat-dialogue/speaker-attribution.ts";

test("creates timing-driven scroll windows for every message", () => {
  const conversationPlan = conversationFixture();
  const animationPlan = buildChatAnimationPlan({ conversationPlan, durationSec: 4 });

  assert.equal(animationPlan.chain_id, "chat_dialogue_mv");
  assert.equal(animationPlan.target_ratio, "9:16");
  assert.deepEqual(animationPlan.message_animations.map((animation) => animation.message_id), ["msg_001", "msg_002"]);
  assert.equal(animationPlan.message_animations[0]!.exit_sec - animationPlan.message_animations[0]!.enter_sec >= 0.6, true);
  assert.deepEqual(animationPlan.scroll_windows.map((window) => window.start_sec), [0, 0.5, 1.5]);
  assert.deepEqual(animationPlan.scroll_windows.map((window) => window.end_sec), [0.5, 1.5, 4]);
  assert.deepEqual(animationPlan.scroll_windows[0]?.visible_message_ids, []);
  assert.deepEqual(animationPlan.scroll_windows[1]?.visible_message_ids, ["msg_001"]);
  assert.deepEqual(animationPlan.scroll_windows[2]?.visible_message_ids, ["msg_001", "msg_002"]);
  assert.equal(validateChatAnimationPlan({ conversationPlan, animationPlan }).ok, true);
});

test("keeps only recent messages visible as lyrics progress", () => {
  const conversationPlan = conversationFixture();
  const seed = conversationPlan.messages[0]!;
  const messages = Array.from({ length: 6 }, (_, index) => ({
    ...seed,
    id: `msg_${String(index + 1).padStart(3, "0")}`,
    source_line_id: `line_${String(index + 1).padStart(3, "0")}`,
    raw_text: `line ${index + 1}`,
    display_text: `line ${index + 1}`,
    start_sec: index,
    end_sec: index + 0.5,
  }));
  const animationPlan = buildChatAnimationPlan({ conversationPlan: { ...conversationPlan, messages }, durationSec: 6 });

  assert.deepEqual(animationPlan.scroll_windows.at(-1)?.visible_message_ids, ["msg_002", "msg_003", "msg_004", "msg_005", "msg_006"]);
  assert.equal(animationPlan.scroll_windows.at(-1)?.visible_message_ids.includes("msg_001"), false);
});

function conversationFixture() {
  const lineMap = buildLyricsLineMap({ lyricsText: "问：hello world?\n答：answer now\n" });
  const result = buildConversationPlan({
    lineMap,
    speakerAttribution: buildSpeakerAttribution({ lineMap }),
    lyricWordTiming: {
      words: [
        { line_id: "line_001", word: "hello", start_sec: 0.5, end_sec: 0.8 },
        { line_id: "line_001", word: "world", start_sec: 0.9, end_sec: 1.2 },
        { line_id: "line_002", word: "answer", start_sec: 1.5, end_sec: 1.8 },
        { line_id: "line_002", word: "now", start_sec: 1.9, end_sec: 2.2 },
      ],
    },
    sectionMap: { duration_sec: 4, sections: [{ section_id: "sec_001", start_sec: 0, end_sec: 4 }] },
  });
  assert.ok(result.conversationPlan);
  return result.conversationPlan;
}
