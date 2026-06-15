import path from "node:path";
import { writeJson } from "../fs-utils.ts";
import type { ChatAnimationPlan } from "./chat-animation-plan.ts";
import type { ConversationPlan } from "./conversation-plan.ts";

export type ChatFrameContracts = {
  schema_version: 1;
  chain_id: "chat_dialogue_mv";
  frames: ChatFrameContract[];
};

export type ChatFrameContract = {
  frame_id: string;
  html_path: string;
  duration_sec: number;
  section_ids: string[];
  message_ids: string[];
  text_policy: "verbatim_lyrics";
  forbidden_remote_resources: true;
};

export function buildChatFrameContracts(input: {
  projectId: string;
  conversationPlan: ConversationPlan;
  animationPlan: ChatAnimationPlan;
}): ChatFrameContracts {
  const frames = input.animationPlan.scroll_windows.map((window, index): ChatFrameContract => ({
    frame_id: `chat_dialogue_mv_${String(index + 1).padStart(3, "0")}`,
    html_path: `video/html-video/.html-video/projects/${input.projectId}/frames/chat_dialogue_mv_${String(index + 1).padStart(3, "0")}.html`,
    duration_sec: Math.max(0.6, frameEndSec(input.animationPlan, index) - frameStartSec(input.animationPlan, index)),
    section_ids: [window.section_id],
    message_ids: window.visible_message_ids,
    text_policy: "verbatim_lyrics",
    forbidden_remote_resources: true,
  }));
  return {
    schema_version: 1,
    chain_id: "chat_dialogue_mv",
    frames,
  };
}

function frameEndSec(animationPlan: ChatAnimationPlan, index: number): number {
  return animationPlan.scroll_windows[index + 1]?.start_sec ?? animationPlan.duration_sec;
}

function frameStartSec(animationPlan: ChatAnimationPlan, index: number): number {
  return index === 0 ? 0 : animationPlan.scroll_windows[index]?.start_sec ?? 0;
}

export async function writeChatFrameContracts(input: {
  projectRoot: string;
  frameContracts: ChatFrameContracts;
}): Promise<{ path: string }> {
  const relativePath = "data/chains/chat_dialogue_mv/frame_contracts.json";
  await writeJson(path.join(input.projectRoot, relativePath), input.frameContracts);
  return { path: relativePath };
}

export function validateChatFrameContracts(input: {
  conversationPlan: ConversationPlan;
  frameContracts: ChatFrameContracts;
}): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const messageIds = new Set(input.conversationPlan.messages.map((message) => message.id));
  const covered = new Set<string>();
  if (input.frameContracts.schema_version !== 1) issues.push("frame_contracts.schema_version must be 1");
  if (input.frameContracts.chain_id !== "chat_dialogue_mv") issues.push("frame_contracts.chain_id must be chat_dialogue_mv");
  for (const frame of input.frameContracts.frames) {
    if (!frame.html_path.startsWith("video/html-video/.html-video/projects/")) issues.push(`${frame.frame_id}.html_path must stay inside html-video project`);
    if (/^https?:\/\//.test(frame.html_path)) issues.push(`${frame.frame_id}.html_path must not be remote`);
    if (frame.duration_sec <= 0) issues.push(`${frame.frame_id}.duration_sec must be positive`);
    if (frame.text_policy !== "verbatim_lyrics") issues.push(`${frame.frame_id}.text_policy must be verbatim_lyrics`);
    for (const messageId of frame.message_ids) {
      if (!messageIds.has(messageId)) issues.push(`${frame.frame_id} references unknown message ${messageId}`);
      covered.add(messageId);
    }
  }
  for (const messageId of messageIds) {
    if (!covered.has(messageId)) issues.push(`frame contracts do not cover ${messageId}`);
  }
  return { ok: issues.length === 0, issues };
}
