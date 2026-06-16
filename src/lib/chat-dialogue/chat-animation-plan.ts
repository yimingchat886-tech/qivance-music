import path from "node:path";
import { writeJson } from "../fs-utils.ts";
import type { ConversationPlan } from "./conversation-plan.ts";

export type ChatAnimationPlan = {
  schema_version: 1;
  chain_id: "chat_dialogue_mv";
  target_ratio: "9:16";
  duration_sec: number;
  template: {
    id: "mobile_dual_chat_default";
    variant: "dark_short_video_chat";
  };
  message_animations: ChatMessageAnimation[];
  scroll_windows: ChatScrollWindow[];
};

export type ChatMessageAnimation = {
  message_id: string;
  enter_sec: number;
  exit_sec: number;
  side: "left" | "right";
  motion: "bubble_pop";
  beat_accent: boolean;
};

export type ChatScrollWindow = {
  section_id: string;
  start_sec: number;
  end_sec: number;
  visible_message_ids: string[];
};

export function buildChatAnimationPlan(input: {
  conversationPlan: ConversationPlan;
  durationSec?: number;
}): ChatAnimationPlan {
  const durationSec = input.durationSec ?? Math.max(...input.conversationPlan.messages.map((message) => message.end_sec), 0);
  const messageAnimations = input.conversationPlan.messages.map((message): ChatMessageAnimation => ({
    message_id: message.id,
    enter_sec: message.start_sec,
    exit_sec: Math.min(durationSec, Math.max(message.end_sec, message.start_sec + 0.6)),
    side: message.side,
    motion: "bubble_pop",
    beat_accent: true,
  }));
  const bySection = new Map<string, string[]>();
  for (const message of input.conversationPlan.messages) {
    const bucket = bySection.get(message.section_id) ?? [];
    bucket.push(message.id);
    bySection.set(message.section_id, bucket);
  }
  const scrollWindows = [...bySection.entries()].map(([sectionId, messageIds]): ChatScrollWindow => {
    const messages = input.conversationPlan.messages.filter((message) => messageIds.includes(message.id));
    return {
      section_id: sectionId,
      start_sec: Math.min(...messages.map((message) => message.start_sec)),
      end_sec: Math.max(...messages.map((message) => message.end_sec)),
      visible_message_ids: messageIds,
    };
  });
  return {
    schema_version: 1,
    chain_id: "chat_dialogue_mv",
    target_ratio: "9:16",
    duration_sec: durationSec,
    template: {
      id: "mobile_dual_chat_default",
      variant: "dark_short_video_chat",
    },
    message_animations: messageAnimations,
    scroll_windows: scrollWindows,
  };
}

export async function writeChatAnimationPlan(input: {
  projectRoot: string;
  animationPlan: ChatAnimationPlan;
}): Promise<{ path: string }> {
  const relativePath = "data/chains/chat_dialogue_mv/animation_plan.json";
  await writeJson(path.join(input.projectRoot, relativePath), input.animationPlan);
  return { path: relativePath };
}

export function validateChatAnimationPlan(input: {
  conversationPlan: ConversationPlan;
  animationPlan: ChatAnimationPlan;
}): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const messageIds = new Set(input.conversationPlan.messages.map((message) => message.id));
  if (input.animationPlan.schema_version !== 1) issues.push("animation_plan.schema_version must be 1");
  if (input.animationPlan.chain_id !== "chat_dialogue_mv") issues.push("animation_plan.chain_id must be chat_dialogue_mv");
  if (input.animationPlan.target_ratio !== "9:16") issues.push("target_ratio must be 9:16 for V4 P0");
  for (const message of input.conversationPlan.messages) {
    if (!input.animationPlan.message_animations.some((animation) => animation.message_id === message.id)) {
      issues.push(`missing animation for ${message.id}`);
    }
  }
  for (const animation of input.animationPlan.message_animations) {
    if (!messageIds.has(animation.message_id)) issues.push(`animation references unknown message ${animation.message_id}`);
    if (animation.exit_sec - animation.enter_sec < 0.6) issues.push(`${animation.message_id} display duration must be at least 0.6s`);
  }
  const visible = new Set(input.animationPlan.scroll_windows.flatMap((window) => window.visible_message_ids));
  for (const messageId of messageIds) {
    if (!visible.has(messageId)) issues.push(`scroll windows do not cover ${messageId}`);
  }
  return { ok: issues.length === 0, issues };
}
