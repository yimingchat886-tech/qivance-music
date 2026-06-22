import assert from "node:assert/strict";
import test from "node:test";
import { buildChatAnimationPlan } from "../src/lib/chat-dialogue/chat-animation-plan.ts";
import { buildChatRuntimeTimeline, validateChatRuntimeTimeline } from "../src/lib/chat-dialogue/chat-runtime-timeline.ts";
import type { ConversationPlan } from "../src/lib/chat-dialogue/conversation-plan.ts";

test("builds browser-recording runtime timeline with absolute message events", () => {
  const conversationPlan = conversationFixture();
  const animationPlan = buildChatAnimationPlan({ conversationPlan, durationSec: 5 });
  const runtimeTimeline = buildChatRuntimeTimeline({ conversationPlan, animationPlan });
  const messageEvents = runtimeTimeline.events.filter((event) => event.type === "message");

  assert.equal(runtimeTimeline.schema_version, 1);
  assert.equal(runtimeTimeline.chain_id, "chat_dialogue_mv");
  assert.equal(runtimeTimeline.render_mode, "browser_recording");
  assert.equal(runtimeTimeline.target_ratio, "9:16");
  assert.equal(runtimeTimeline.fps, 60);
  assert.equal(runtimeTimeline.duration_sec, 5);
  assert.deepEqual(messageEvents.map((event) => event.at_sec), [0.5, 1.5, 3]);
  assert.equal(messageEvents[0]?.show_receipt_after_enter, true);
  assert.equal(messageEvents[1]?.enter_delay_ms, 40);
  assert.equal(messageEvents[1]?.hide_receipt_message_id, "msg_001");
  assert.equal(messageEvents[1]?.header_phase, "typing-during-enter");
  assert.equal(messageEvents[2]?.show_receipt_after_enter, false);
  assert.equal(runtimeTimeline.events.at(-1)?.type, "end");
  assert.equal(validateChatRuntimeTimeline({ conversationPlan, runtimeTimeline }).ok, true);
});

test("targets the nearest previous right questioner before a left reply", () => {
  const conversationPlan = conversationFixture([
    { id: "msg_001", side: "right", speaker: "questioner", start_sec: 0.5, end_sec: 1, display_text: "first right" },
    { id: "msg_002", side: "right", speaker: "questioner", start_sec: 1.2, end_sec: 1.7, display_text: "nearest right" },
    { id: "msg_003", side: "left", speaker: "answerer", start_sec: 2, end_sec: 2.7, display_text: "left answer" },
  ]);
  const runtimeTimeline = buildChatRuntimeTimeline({
    conversationPlan,
    animationPlan: buildChatAnimationPlan({ conversationPlan, durationSec: 4 }),
  });
  const events = runtimeTimeline.events.filter((event) => event.type === "message");

  assert.equal(events[0]?.show_receipt_after_enter, false);
  assert.equal(events[1]?.show_receipt_after_enter, true);
  assert.equal(events[2]?.hide_receipt_message_id, "msg_002");
  assert.equal(validateChatRuntimeTimeline({ conversationPlan, runtimeTimeline }).ok, true);
});

test("validates runtime timeline message references and receipt rules", () => {
  const conversationPlan = conversationFixture();
  const runtimeTimeline = buildChatRuntimeTimeline({
    conversationPlan,
    animationPlan: buildChatAnimationPlan({ conversationPlan, durationSec: 5 }),
  });
  const broken = {
    ...runtimeTimeline,
    fps: 30,
    events: runtimeTimeline.events.map((event) =>
      event.type === "message" && event.message_id === "msg_002"
        ? { ...event, enter_delay_ms: 0, hide_receipt_message_id: "msg_003" }
        : event
    ),
  };
  const validation = validateChatRuntimeTimeline({ conversationPlan, runtimeTimeline: broken });

  assert.equal(validation.ok, false);
  assert.match(validation.issues.join("\n"), /fps must be 60/);
  assert.match(validation.issues.join("\n"), /enter_delay_ms must be 40/);
  assert.match(validation.issues.join("\n"), /hide_receipt_message_id must point/);
});

function conversationFixture(messages = [
  { id: "msg_001", side: "right", speaker: "questioner", start_sec: 0.5, end_sec: 1.2, display_text: "hello world?" },
  { id: "msg_002", side: "left", speaker: "answerer", start_sec: 1.5, end_sec: 2.2, display_text: "answer now" },
  { id: "msg_003", side: "right", speaker: "questioner", start_sec: 3, end_sec: 3.6, display_text: "last question" },
] as Array<{ id: string; side: "left" | "right"; speaker: "questioner" | "answerer"; start_sec: number; end_sec: number; display_text: string }>): ConversationPlan {
  return {
    schema_version: 1,
    chain_id: "chat_dialogue_mv",
    text_policy: "verbatim_lyrics",
    source: {
      lyrics_path: "lyrics.md",
      audio_path: "active_music_take.mp3",
      lyrics_sha256: "lyrics",
      audio_sha256: "audio",
    },
    timing: {
      source: "lyric_word_timing",
      lyric_word_timing_path: "data/timing/lyric_word_timing.json",
      section_map_path: "data/timing/section_map.json",
      diagnostic_fallback_used: false,
    },
    speakers: [],
    messages: messages.map((message, index) => ({
      ...message,
      source_line_id: `line_${String(index + 1).padStart(3, "0")}`,
      raw_text: message.display_text,
      text_policy: "verbatim_lyrics",
      attribution_source: message.speaker === "questioner" ? "explicit_question_prefix" : "explicit_answer_prefix",
      section_id: "sec_001",
      confidence: 0.95,
    })),
  };
}
