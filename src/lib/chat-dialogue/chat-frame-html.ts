import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatFrameContract } from "./chat-frame-contracts.ts";
import type { ConversationPlan } from "./conversation-plan.ts";

type ChatFrameUiProfile = {
  contact_name?: string;
  contact_status?: string;
  contact_avatar_src?: string;
  left_avatar_src?: string;
  right_avatar_src?: string;
};

type ResolvedChatFrameUiProfile = {
  contactName: string;
  contactStatus: string;
  contactAvatarSrc?: string;
  leftAvatarSrc?: string;
  rightAvatarSrc?: string;
};

const STATUS_ICON_BASE = "../assets/status_bar_icons/";
const STATUS_ICON_FILES = ["back_arrow.png", "avatar_online.png", "online_dot.png", "video_camera.png", "more_ellipsis.png"] as const;
const REQUIRED_HEADER_ICON_FILES = ["back_arrow.png", "video_camera.png", "more_ellipsis.png"] as const;

export function renderChatFrameHtml(input: {
  frame: ChatFrameContract;
  conversationPlan: ConversationPlan;
}): string {
  const messages = input.conversationPlan.messages.filter((message) => input.frame.message_ids.includes(message.id));
  const uiProfile = chatFrameUiProfile(input.conversationPlan);
  const headerTitle = latestVisibleMessage(messages)?.side === "left" ? "对方正在输入...." : uiProfile.contactName;
  const messageRowsHtml = renderMessageRows(messages, uiProfile);
  const payload = JSON.stringify({ frame: input.frame, messages }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${input.frame.frame_id}</title>
<style>
html, body { margin: 0; width: 100%; height: 100%; background: #efefef; color: #161823; font-family: Arial, "PingFang SC", "Microsoft YaHei", sans-serif; letter-spacing: 0; }
.stage { position: relative; width: 1080px; height: 1920px; overflow: hidden; background: #efefef; }
.top { position: absolute; top: 0; left: 0; right: 0; height: 150px; background: #efefef; border-bottom: 1px solid #d5d5d7; box-sizing: border-box; }
.top-icon { position: absolute; display: block; object-fit: contain; user-select: none; pointer-events: none; }
.back-icon { left: 46px; top: 52px; width: 37px; height: 58px; }
.video-icon-img { right: 143px; top: 66px; width: 71px; height: 52px; }
.more-icon-img { right: 43px; top: 82px; width: 58px; height: 20px; }
.header-avatar-wrap { position: absolute; left: 125px; top: 39px; width: 104px; height: 104px; }
.header-avatar-icon { width: 104px; height: 104px; display: block; object-fit: contain; }
.online-dot { position: absolute; right: -3px; bottom: 0; width: 40px; height: 37px; display: block; }
.title { position: absolute; left: 249px; right: 250px; top: 49px; min-width: 0; }
.name { color: #161823; font-size: 38px; font-weight: 700; line-height: 48px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.online { color: #6d6e75; font-size: 29px; font-weight: 400; line-height: 36px; white-space: nowrap; }
.safety-notice { position: absolute; left: 126px; right: 126px; top: 199px; color: #6d6e75; font-size: 33px; font-weight: 400; line-height: 48px; text-align: center; }
.time-marker { color: #6d6e75; font-size: 32px; font-weight: 400; line-height: 38px; text-align: center; }
.top-time { position: absolute; left: 0; right: 0; top: 338px; }
.chat { position: absolute; top: 419px; left: 32px; right: 28px; bottom: 0; display: flex; flex-direction: column; gap: 42px; justify-content: flex-start; align-items: stretch; overflow: hidden; }
.row { display: flex; align-items: flex-start; width: 100%; gap: 20px; }
.row.left { justify-content: flex-start; }
.row.right { justify-content: flex-end; }
.row.right .message-avatar { order: 2; }
.bubble-stack { display: flex; flex-direction: column; align-items: flex-start; }
.row.right .bubble-stack { align-items: flex-end; }
.avatar-slot { position: relative; overflow: hidden; border-radius: 50%; flex: 0 0 auto; background: #bfbfbf; }
.avatar-slot::before { content: ""; position: absolute; left: 35%; top: 20%; width: 30%; height: 30%; border-radius: 50%; background: #f5f5f5; }
.avatar-slot::after { content: ""; position: absolute; left: 13%; top: 58%; width: 74%; height: 44%; border-radius: 50% 50% 0 0; background: #f5f5f5; }
.avatar-img { position: absolute; inset: 0; z-index: 2; width: 100%; height: 100%; display: block; object-fit: cover; border-radius: inherit; }
.header-avatar { width: 104px; height: 104px; }
.message-avatar { width: 104px; height: 104px; margin-top: 0; }
.bubble { max-width: 690px; min-height: 102px; padding: 22px 32px 23px; border-radius: 20px; box-sizing: border-box; font-size: 40px; font-weight: 400; line-height: 1.36; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; box-shadow: none; }
.left .bubble { background: #ffffff; color: #161823; }
.right .bubble { background: #4f7aff; color: #ffffff; }
.time-marker.inline { flex: 0 0 auto; align-self: center; margin: 10px 0 7px; }
.read-receipt { margin-top: 18px; display: inline-flex; align-items: center; gap: 8px; color: #777982; font-size: 30px; font-weight: 400; line-height: 36px; }
.receipt-avatar { position: relative; width: 38px; height: 38px; overflow: hidden; border-radius: 50%; background: #c7c7c7; flex: 0 0 auto; }
.receipt-avatar::before { content: ""; position: absolute; left: 14px; top: 7px; width: 11px; height: 11px; border-radius: 50%; background: #f4f4f4; }
.receipt-avatar::after { content: ""; position: absolute; left: 7px; top: 23px; width: 24px; height: 16px; border-radius: 50% 50% 0 0; background: #f4f4f4; }
</style>
</head>
<body>
<main class="stage" data-douyin-chat-shell>
  <header class="top" aria-label="抖音私信页头部">
    <img class="top-icon back-icon" src="${escapeHtml(statusIcon("back_arrow.png"))}" aria-hidden="true" alt="">
    ${headerAvatarHtml(uiProfile)}
    <div class="title"><div class="name">${escapeHtml(headerTitle)}</div><div class="online">${escapeHtml(uiProfile.contactStatus)}</div></div>
    <img class="top-icon video-icon-img" src="${escapeHtml(statusIcon("video_camera.png"))}" aria-hidden="true" alt="">
    <img class="top-icon more-icon-img" src="${escapeHtml(statusIcon("more_ellipsis.png"))}" aria-hidden="true" alt="">
  </header>
  <div class="safety-notice" aria-hidden="true">为保障用户沟通安全，未互相关注的陌生人违规消息可能<br>会被处理，请遵守法律法规和社区规范</div>
  <div class="time-marker top-time" aria-hidden="true">15:31</div>
  <section class="chat" aria-label="聊天消息">
${messageRowsHtml}
  </section>
</main>
<script type="application/json" id="qivance-chat-data">${payload}</script>
</body>
</html>
`;
}

export async function writeChatFrameHtml(input: {
  htmlPath: string;
  frame: ChatFrameContract;
  conversationPlan: ConversationPlan;
}): Promise<void> {
  await mkdir(path.dirname(input.htmlPath), { recursive: true });
  await writeFile(input.htmlPath, renderChatFrameHtml(input), "utf8");
  await writeStatusBarIconAssets(path.dirname(input.htmlPath));
}

export function validateChatFrameHtml(html: string): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (/https?:\/\//.test(html)) issues.push("chat frame html must not reference remote resources");
  if (/@import/i.test(html)) issues.push("chat frame html must not import remote or external stylesheets");
  if (!html.includes("qivance-chat-data")) issues.push("chat frame html must embed qivance-chat-data");
  if (!/overflow-wrap:\s*anywhere/.test(html)) issues.push("chat frame html must include long-text wrapping");
  if (!html.includes("data-douyin-chat-shell")) issues.push("chat frame html must render the v7 Douyin-style shell");
  if (/class="status-bar"|15:30|battery/.test(html)) issues.push("chat frame html must not include a phone status bar");
  for (const fileName of REQUIRED_HEADER_ICON_FILES) {
    if (!html.includes(statusIcon(fileName))) issues.push(`chat frame html must reference ${fileName}`);
  }
  if (!html.includes(statusIcon("avatar_online.png")) && !/class="avatar-slot header-avatar"/.test(html)) issues.push("chat frame html must include a default or custom contact avatar");
  if (!/justify-content:\s*flex-start/.test(html)) issues.push("chat messages must start from the top of the chat area");
  if (/#743df2|#1689ff/.test(html)) issues.push("chat bubbles must use latest-reference colors");
  if (!/class="safety-notice"/.test(html)) issues.push("chat frame html must include the safety notice");
  if (!/>15:31</.test(html)) issues.push("chat frame html must include the latest-reference chat time");
  if (/quick-actions|composer|发消息或按住说话/.test(html)) issues.push("chat frame html must not render the old bottom composer or quick actions");
  if (!/class="header-avatar-wrap"/.test(html)) issues.push("chat frame html must include a replaceable header avatar slot");
  if (!/data-avatar-role="contact"/.test(html)) issues.push("chat frame html must expose a contact avatar slot");
  if (!/class="avatar-slot message-avatar /.test(html)) issues.push("chat frame html must include replaceable message avatar slots");
  if (/class="row right"/.test(html) && !/class="read-receipt"/.test(html)) issues.push("right-side messages must expose a read receipt");
  if (/letter-spacing:\s*-/.test(html)) issues.push("chat frame html must not use negative letter spacing");
  return { ok: issues.length === 0, issues };
}

async function writeStatusBarIconAssets(frameDir: string): Promise<void> {
  const outputDir = path.resolve(frameDir, "../assets/status_bar_icons");
  await mkdir(outputDir, { recursive: true });
  await Promise.all(STATUS_ICON_FILES.map((fileName) => copyFile(new URL(`./assets/status_bar_icons/${fileName}`, import.meta.url), path.join(outputDir, fileName))));
}

function chatFrameUiProfile(conversationPlan: ConversationPlan): ResolvedChatFrameUiProfile {
  const ui = (conversationPlan as ConversationPlan & { chat_ui?: ChatFrameUiProfile }).chat_ui ?? {};
  return {
    contactName: nonEmpty(ui.contact_name) ?? "蒲涛",
    contactStatus: nonEmpty(ui.contact_status) ?? "在线",
    contactAvatarSrc: nonEmpty(ui.contact_avatar_src),
    leftAvatarSrc: nonEmpty(ui.left_avatar_src),
    rightAvatarSrc: nonEmpty(ui.right_avatar_src),
  };
}

function latestVisibleMessage(messages: ConversationPlan["messages"]): ConversationPlan["messages"][number] | undefined {
  return messages.reduce<ConversationPlan["messages"][number] | undefined>((latest, message) => {
    if (!latest || message.start_sec >= latest.start_sec) return message;
    return latest;
  }, undefined);
}

function renderMessageRows(messages: ConversationPlan["messages"], uiProfile: ResolvedChatFrameUiProfile): string {
  const lastRightIndex = messages.reduce((lastIndex, message, index) => (message.side === "right" ? index : lastIndex), -1);
  return messages.map((message, index) => renderMessageRow({ message, index, lastRightIndex, uiProfile })).join("\n");
}

function renderMessageRow(input: {
  message: ConversationPlan["messages"][number];
  index: number;
  lastRightIndex: number;
  uiProfile: ResolvedChatFrameUiProfile;
}): string {
  const side = input.message.side;
  const inlineTime = input.index === 2 ? `    <div class="time-marker inline" aria-hidden="true">刚刚</div>\n` : "";
  const avatarSrc = side === "left" ? input.uiProfile.leftAvatarSrc : input.uiProfile.rightAvatarSrc;
  const readReceipt = side === "right" && input.index === input.lastRightIndex ? `<div class="read-receipt" aria-hidden="true"><span class="receipt-avatar"></span><span>已读</span></div>` : "";
  return `${inlineTime}    <div class="row ${side}"><div class="avatar-slot message-avatar avatar-${side}" data-avatar-role="${side}-speaker" aria-hidden="true">${avatarImg(avatarSrc)}</div><div class="bubble-stack"><div class="bubble" data-message-id="${escapeHtml(input.message.id)}">${escapeHtml(input.message.display_text)}</div>${readReceipt}</div></div>`;
}

function headerAvatarHtml(uiProfile: ResolvedChatFrameUiProfile): string {
  if (uiProfile.contactAvatarSrc) {
    return `<div class="header-avatar-wrap" data-avatar-role="contact" aria-hidden="true"><div class="avatar-slot header-avatar">${avatarImg(uiProfile.contactAvatarSrc)}</div><img class="online-dot" src="${escapeHtml(statusIcon("online_dot.png"))}" alt=""></div>`;
  }
  return `<div class="header-avatar-wrap" data-avatar-role="contact" aria-hidden="true"><img class="header-avatar-icon" src="${escapeHtml(statusIcon("avatar_online.png"))}" alt=""></div>`;
}

function avatarImg(src: string | undefined): string {
  return src ? `<img class="avatar-img" src="${escapeHtml(src)}" alt="">` : "";
}

function statusIcon(fileName: (typeof STATUS_ICON_FILES)[number]): string {
  return `${STATUS_ICON_BASE}${fileName}`;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
