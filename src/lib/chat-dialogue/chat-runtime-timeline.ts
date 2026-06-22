import path from "node:path";
import { writeJson } from "../fs-utils.ts";
import type { ChatAnimationPlan } from "./chat-animation-plan.ts";
import type { ConversationPlan } from "./conversation-plan.ts";

export type ChatRuntimeTimeline = {
  schema_version: 1;
  chain_id: "chat_dialogue_mv";
  render_mode: "browser_recording";
  target_ratio: "9:16";
  width: number;
  height: number;
  fps: number;
  duration_sec: number;
  events: ChatRuntimeEvent[];
  css_motion: ChatRuntimeCssMotion;
};

export type ChatRuntimeCssMotion = {
  right_bubble_ms: number;
  left_bubble_ms: number;
  receipt_in_ms: number;
  receipt_out_ms: number;
  header_swap_ms: number;
  left_enter_delay_ms: number;
};

export type ChatRuntimeEvent =
  | {
      type: "message";
      message_id: string;
      side: "left" | "right";
      speaker: "questioner" | "answerer";
      at_sec: number;
      enter_delay_ms: number;
      show_receipt_after_enter: boolean;
      hide_receipt_message_id?: string;
      header_phase: "default" | "typing-during-enter";
    }
  | {
      type: "end";
      at_sec: number;
    };

export const CHAT_RUNTIME_TIMELINE_PATH = "data/chains/chat_dialogue_mv/runtime_timeline.json";

export const CHAT_RUNTIME_CSS_MOTION: ChatRuntimeCssMotion = {
  right_bubble_ms: 230,
  left_bubble_ms: 260,
  receipt_in_ms: 120,
  receipt_out_ms: 100,
  header_swap_ms: 120,
  left_enter_delay_ms: 40,
};

export function buildChatRuntimeTimeline(input: {
  conversationPlan: ConversationPlan;
  animationPlan: ChatAnimationPlan;
  fps?: number;
  width?: number;
  height?: number;
}): ChatRuntimeTimeline {
  const receiptTargets = buildReceiptTargets(input.conversationPlan.messages);
  const byRight = new Map(receiptTargets.map((target) => [target.rightMessageId, target]));
  const byLeft = new Map(receiptTargets.map((target) => [target.leftMessageId, target]));
  const events: ChatRuntimeEvent[] = input.conversationPlan.messages.map((message) => {
    const targetForLeft = byLeft.get(message.id);
    return {
      type: "message",
      message_id: message.id,
      side: message.side,
      speaker: message.speaker,
      at_sec: message.start_sec,
      enter_delay_ms: message.side === "left" ? CHAT_RUNTIME_CSS_MOTION.left_enter_delay_ms : 0,
      show_receipt_after_enter: byRight.has(message.id),
      ...(targetForLeft ? { hide_receipt_message_id: targetForLeft.rightMessageId } : {}),
      header_phase: message.side === "left" ? "typing-during-enter" : "default",
    };
  });

  return {
    schema_version: 1,
    chain_id: "chat_dialogue_mv",
    render_mode: "browser_recording",
    target_ratio: "9:16",
    width: input.width ?? 1080,
    height: input.height ?? 1920,
    fps: input.fps ?? 60,
    duration_sec: input.animationPlan.duration_sec,
    events: [...events, { type: "end", at_sec: input.animationPlan.duration_sec }],
    css_motion: CHAT_RUNTIME_CSS_MOTION,
  };
}

export async function writeChatRuntimeTimeline(input: {
  projectRoot: string;
  runtimeTimeline: ChatRuntimeTimeline;
}): Promise<{ path: string }> {
  await writeJson(path.join(input.projectRoot, CHAT_RUNTIME_TIMELINE_PATH), input.runtimeTimeline);
  return { path: CHAT_RUNTIME_TIMELINE_PATH };
}

export function validateChatRuntimeTimeline(input: {
  conversationPlan: ConversationPlan;
  runtimeTimeline: ChatRuntimeTimeline;
}): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const { conversationPlan, runtimeTimeline } = input;
  const messageById = new Map(conversationPlan.messages.map((message) => [message.id, message]));
  const receiptTargets = buildReceiptTargets(conversationPlan.messages);
  const receiptRightIds = new Set(receiptTargets.map((target) => target.rightMessageId));
  const receiptLeftToRight = new Map(receiptTargets.map((target) => [target.leftMessageId, target.rightMessageId]));

  if (runtimeTimeline.schema_version !== 1) issues.push("runtime_timeline.schema_version must be 1");
  if (runtimeTimeline.chain_id !== "chat_dialogue_mv") issues.push("runtime_timeline.chain_id must be chat_dialogue_mv");
  if (runtimeTimeline.render_mode !== "browser_recording") issues.push("runtime_timeline.render_mode must be browser_recording");
  if (runtimeTimeline.target_ratio !== "9:16") issues.push("runtime_timeline.target_ratio must be 9:16");
  if (runtimeTimeline.fps !== 60) issues.push("runtime_timeline.fps must be 60");
  if (runtimeTimeline.duration_sec <= 0) issues.push("runtime_timeline.duration_sec must be positive");
  if (runtimeTimeline.css_motion.left_enter_delay_ms !== CHAT_RUNTIME_CSS_MOTION.left_enter_delay_ms) {
    issues.push("runtime_timeline.css_motion.left_enter_delay_ms must be 40");
  }

  let previousAtSec = -Infinity;
  const seenReceiptRight = new Set<string>();
  for (const event of runtimeTimeline.events) {
    if (event.at_sec < previousAtSec) issues.push("runtime_timeline.events must be sorted by at_sec");
    previousAtSec = event.at_sec;
    if (event.type === "end") continue;
    const message = messageById.get(event.message_id);
    if (!message) {
      issues.push(`runtime_timeline event references unknown message ${event.message_id}`);
      continue;
    }
    if (event.side !== message.side) issues.push(`${event.message_id}.side must match conversation_plan`);
    if (event.speaker !== message.speaker) issues.push(`${event.message_id}.speaker must match conversation_plan`);
    if (event.side === "left" && event.enter_delay_ms !== CHAT_RUNTIME_CSS_MOTION.left_enter_delay_ms) {
      issues.push(`${event.message_id}.enter_delay_ms must be 40 for left messages`);
    }
    if (event.side === "right" && event.enter_delay_ms !== 0) issues.push(`${event.message_id}.enter_delay_ms must be 0 for right messages`);
    const shouldShowReceipt = event.side === "right" && event.speaker === "questioner" && receiptRightIds.has(event.message_id);
    if (event.show_receipt_after_enter !== shouldShowReceipt) {
      issues.push(`${event.message_id}.show_receipt_after_enter does not match receipt target rule`);
    }
    if (event.show_receipt_after_enter) seenReceiptRight.add(event.message_id);
    const expectedHiddenReceipt = receiptLeftToRight.get(event.message_id);
    if (expectedHiddenReceipt && event.hide_receipt_message_id !== expectedHiddenReceipt) {
      issues.push(`${event.message_id}.hide_receipt_message_id must point to previous receipt right message`);
    }
    if (event.hide_receipt_message_id && !seenReceiptRight.has(event.hide_receipt_message_id)) {
      issues.push(`${event.message_id}.hide_receipt_message_id must reference a previous shown receipt`);
    }
  }

  const endEvent = runtimeTimeline.events.find((event) => event.type === "end");
  const lastMessage = conversationPlan.messages.at(-1);
  if (!endEvent) issues.push("runtime_timeline.events must include an end event");
  if (endEvent && lastMessage && endEvent.at_sec < lastMessage.start_sec) issues.push("runtime_timeline end event must be after the last message start");
  return { ok: issues.length === 0, issues };
}

type ReceiptTarget = {
  rightMessageId: string;
  leftMessageId: string;
};

function buildReceiptTargets(messages: ConversationPlan["messages"]): ReceiptTarget[] {
  const targets: ReceiptTarget[] = [];
  for (let leftIndex = 0; leftIndex < messages.length; leftIndex += 1) {
    const left = messages[leftIndex]!;
    if (left.side !== "left") continue;
    for (let index = leftIndex - 1; index >= 0; index -= 1) {
      const candidate = messages[index]!;
      if (candidate.side === "left") break;
      if (candidate.side === "right" && candidate.speaker === "questioner") {
        targets.push({ rightMessageId: candidate.id, leftMessageId: left.id });
        break;
      }
    }
  }
  return targets;
}
