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
  ui_state: ChatFrameUiState;
  text_policy: "verbatim_lyrics";
  forbidden_remote_resources: true;
};

export type ChatFrameUiState = {
  header: ChatFrameHeaderUiState;
  entering_message_id?: string;
  enter_progress?: number;
  read_receipt?: ChatFrameReadReceiptUiState;
};

export type ChatFrameHeaderUiState = {
  phase: "default" | "typing-in" | "typing-on" | "typing-out";
  progress?: number;
};

export type ChatFrameReadReceiptUiState = {
  message_id: string;
  state: "hidden" | "in" | "on" | "out";
  progress?: number;
};

const CHAT_VISUAL_FPS = 30;
const RIGHT_BUBBLE_IN_SEC = 0.23;
const LEFT_BUBBLE_IN_SEC = 0.26;
const READ_RECEIPT_DELAY_SEC = 0.05;
const READ_RECEIPT_IN_SEC = 0.12;
const READ_RECEIPT_OUT_SEC = 0.1;
const LEFT_PRELUDE_SEC = 0.04;
const HEADER_SWAP_SEC = 0.12;
const EPSILON_SEC = 0.000001;

export function buildChatFrameContracts(input: {
  projectId: string;
  conversationPlan: ConversationPlan;
  animationPlan: ChatAnimationPlan;
}): ChatFrameContracts {
  const receiptTargets = buildReceiptTargets(input.conversationPlan.messages);
  const frames: ChatFrameContract[] = [];
  for (const window of input.animationPlan.scroll_windows) {
    let cursor = window.start_sec;
    while (cursor < window.end_sec - EPSILON_SEC) {
      const next = Math.min(window.end_sec, cursor + 1 / CHAT_VISUAL_FPS);
      const frameNumber = frames.length + 1;
      const frameId = `chat_dialogue_mv_${String(frameNumber).padStart(3, "0")}`;
      frames.push({
        frame_id: frameId,
        html_path: `video/html-video/.html-video/projects/${input.projectId}/frames/${frameId}.html`,
        duration_sec: roundSec(next - cursor),
        section_ids: [window.section_id],
        message_ids: window.visible_message_ids,
        ui_state: buildUiState({
          timeSec: cursor,
          messageIds: window.visible_message_ids,
          conversationPlan: input.conversationPlan,
          receiptTargets,
        }),
        text_policy: "verbatim_lyrics",
        forbidden_remote_resources: true,
      });
      cursor = next;
    }
  }
  adjustFinalDuration(frames, input.animationPlan.duration_sec);
  return {
    schema_version: 1,
    chain_id: "chat_dialogue_mv",
    frames,
  };
}

function adjustFinalDuration(frames: ChatFrameContract[], durationSec: number): void {
  if (frames.length === 0) return;
  const priorDuration = frames.slice(0, -1).reduce((sum, frame) => sum + frame.duration_sec, 0);
  frames[frames.length - 1]!.duration_sec = roundSec(durationSec - priorDuration);
}

type ReceiptTarget = {
  rightMessageId: string;
  rightStartSec: number;
  leftStartSec: number;
};

function buildReceiptTargets(messages: ConversationPlan["messages"]): ReceiptTarget[] {
  const targets: ReceiptTarget[] = [];
  for (let leftIndex = 0; leftIndex < messages.length; leftIndex += 1) {
    const leftMessage = messages[leftIndex]!;
    if (leftMessage.side !== "left") continue;
    for (let index = leftIndex - 1; index >= 0; index -= 1) {
      const candidate = messages[index]!;
      if (candidate.side === "left") break;
      if (candidate.side === "right" && candidate.speaker === "questioner") {
        targets.push({
          rightMessageId: candidate.id,
          rightStartSec: candidate.start_sec,
          leftStartSec: leftMessage.start_sec,
        });
        break;
      }
    }
  }
  return targets;
}

function buildUiState(input: {
  timeSec: number;
  messageIds: string[];
  conversationPlan: ConversationPlan;
  receiptTargets: ReceiptTarget[];
}): ChatFrameUiState {
  const messageById = new Map(input.conversationPlan.messages.map((message) => [message.id, message]));
  const visibleMessages = input.messageIds.flatMap((messageId) => {
    const message = messageById.get(messageId);
    return message ? [message] : [];
  });
  const entering = enteringMessageAt(input.timeSec, visibleMessages);
  const readReceipt = readReceiptAt(input.timeSec, new Set(input.messageIds), input.receiptTargets);
  return {
    header: headerAt(input.timeSec, input.conversationPlan.messages),
    ...(entering ? { entering_message_id: entering.messageId, enter_progress: entering.progress } : {}),
    ...(readReceipt ? { read_receipt: readReceipt } : {}),
  };
}

function enteringMessageAt(timeSec: number, messages: ConversationPlan["messages"]): { messageId: string; progress: number } | undefined {
  let entering: { messageId: string; progress: number; startSec: number } | undefined;
  for (const message of messages) {
    const startSec = message.side === "left" ? message.start_sec + LEFT_PRELUDE_SEC : message.start_sec;
    const preludeStartSec = message.side === "left" ? message.start_sec : startSec;
    const durationSec = message.side === "left" ? LEFT_BUBBLE_IN_SEC : RIGHT_BUBBLE_IN_SEC;
    if (message.side === "left" && timeSec >= preludeStartSec && timeSec < startSec) {
      entering = latestEntering(entering, { messageId: message.id, progress: 0, startSec: message.start_sec });
      continue;
    }
    if (timeSec >= startSec && timeSec < startSec + durationSec) {
      entering = latestEntering(entering, { messageId: message.id, progress: clamp01((timeSec - startSec) / durationSec), startSec });
    }
  }
  return entering ? { messageId: entering.messageId, progress: roundProgress(entering.progress) } : undefined;
}

function latestEntering(
  current: { messageId: string; progress: number; startSec: number } | undefined,
  next: { messageId: string; progress: number; startSec: number },
): { messageId: string; progress: number; startSec: number } {
  return !current || next.startSec >= current.startSec ? next : current;
}

function headerAt(timeSec: number, messages: ConversationPlan["messages"]): ChatFrameHeaderUiState {
  let active: ChatFrameHeaderUiState | undefined;
  let activeStartSec = -Infinity;
  for (const message of messages) {
    if (message.side !== "left") continue;
    const typingInEndSec = message.start_sec + HEADER_SWAP_SEC;
    const typingOutStartSec = message.start_sec + LEFT_PRELUDE_SEC + LEFT_BUBBLE_IN_SEC;
    const typingOutEndSec = typingOutStartSec + HEADER_SWAP_SEC;
    if (timeSec >= message.start_sec && timeSec < typingInEndSec) {
      active = { phase: "typing-in", progress: roundProgress((timeSec - message.start_sec) / HEADER_SWAP_SEC) };
      activeStartSec = message.start_sec;
    } else if (timeSec >= typingInEndSec && timeSec < typingOutStartSec && message.start_sec >= activeStartSec) {
      active = { phase: "typing-on", progress: 1 };
      activeStartSec = message.start_sec;
    } else if (timeSec >= typingOutStartSec && timeSec < typingOutEndSec && message.start_sec >= activeStartSec) {
      active = { phase: "typing-out", progress: roundProgress((timeSec - typingOutStartSec) / HEADER_SWAP_SEC) };
      activeStartSec = message.start_sec;
    }
  }
  return active ?? { phase: "default" };
}

function readReceiptAt(timeSec: number, visibleMessageIds: Set<string>, receiptTargets: ReceiptTarget[]): ChatFrameReadReceiptUiState | undefined {
  for (let index = receiptTargets.length - 1; index >= 0; index -= 1) {
    const target = receiptTargets[index]!;
    if (!visibleMessageIds.has(target.rightMessageId)) continue;
    const receiptInStartSec = target.rightStartSec + RIGHT_BUBBLE_IN_SEC + READ_RECEIPT_DELAY_SEC;
    const receiptInEndSec = receiptInStartSec + READ_RECEIPT_IN_SEC;
    const receiptOutEndSec = target.leftStartSec + READ_RECEIPT_OUT_SEC;
    if (timeSec >= target.leftStartSec && timeSec < receiptOutEndSec) {
      return { message_id: target.rightMessageId, state: "out", progress: roundProgress((timeSec - target.leftStartSec) / READ_RECEIPT_OUT_SEC) };
    }
    if (timeSec >= receiptOutEndSec) return { message_id: target.rightMessageId, state: "hidden" };
    if (timeSec < receiptInStartSec) return { message_id: target.rightMessageId, state: "hidden" };
    if (timeSec < receiptInEndSec) {
      return { message_id: target.rightMessageId, state: "in", progress: roundProgress((timeSec - receiptInStartSec) / READ_RECEIPT_IN_SEC) };
    }
    return { message_id: target.rightMessageId, state: "on" };
  }
  return undefined;
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
  const messageById = new Map(input.conversationPlan.messages.map((message) => [message.id, message]));
  const messageIds = new Set(messageById.keys());
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
    validateFrameUiState({ frame, messageById, issues });
  }
  for (const messageId of messageIds) {
    if (!covered.has(messageId)) issues.push(`frame contracts do not cover ${messageId}`);
  }
  return { ok: issues.length === 0, issues };
}

function validateFrameUiState(input: {
  frame: ChatFrameContract;
  messageById: Map<string, ConversationPlan["messages"][number]>;
  issues: string[];
}): void {
  const { frame, messageById, issues } = input;
  if (!frame.ui_state) {
    issues.push(`${frame.frame_id}.ui_state is required`);
    return;
  }
  const header = frame.ui_state.header;
  if (!header || !["default", "typing-in", "typing-on", "typing-out"].includes(header.phase)) issues.push(`${frame.frame_id}.ui_state.header.phase is invalid`);
  if (header?.progress !== undefined && !isProgress(header.progress)) issues.push(`${frame.frame_id}.ui_state.header.progress must be 0..1`);
  if (frame.ui_state.entering_message_id) {
    if (!frame.message_ids.includes(frame.ui_state.entering_message_id)) issues.push(`${frame.frame_id}.ui_state.entering_message_id must be visible`);
    if (frame.ui_state.enter_progress === undefined || !isProgress(frame.ui_state.enter_progress)) {
      issues.push(`${frame.frame_id}.ui_state.enter_progress must be 0..1`);
    }
  } else if (frame.ui_state.enter_progress !== undefined) {
    issues.push(`${frame.frame_id}.ui_state.enter_progress requires entering_message_id`);
  }
  const receipt = frame.ui_state.read_receipt;
  if (!receipt) return;
  const receiptMessage = messageById.get(receipt.message_id);
  if (!frame.message_ids.includes(receipt.message_id)) issues.push(`${frame.frame_id}.ui_state.read_receipt.message_id must be visible`);
  if (!receiptMessage) {
    issues.push(`${frame.frame_id}.ui_state.read_receipt references unknown message ${receipt.message_id}`);
  } else if (receiptMessage.side !== "right" || receiptMessage.speaker !== "questioner") {
    issues.push(`${frame.frame_id}.ui_state.read_receipt.message_id must be a right questioner message`);
  }
  if (!["hidden", "in", "on", "out"].includes(receipt.state)) issues.push(`${frame.frame_id}.ui_state.read_receipt.state is invalid`);
  if (receipt.progress !== undefined && !isProgress(receipt.progress)) issues.push(`${frame.frame_id}.ui_state.read_receipt.progress must be 0..1`);
}

function isProgress(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundProgress(value: number): number {
  return Number(clamp01(value).toFixed(4));
}

function roundSec(value: number): number {
  return Number(value.toFixed(6));
}
