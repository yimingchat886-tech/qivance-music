import { mkdir, writeFile } from "node:fs/promises";
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

export function renderChatFrameHtml(input: {
  frame: ChatFrameContract;
  conversationPlan: ConversationPlan;
}): string {
  const messages = input.conversationPlan.messages.filter((message) => input.frame.message_ids.includes(message.id));
  const uiProfile = chatFrameUiProfile(input.conversationPlan);
  const headerTitle = latestVisibleMessage(messages)?.side === "left" ? "对方正在输入...." : uiProfile.contactName;
  const payload = JSON.stringify({ frame: input.frame, messages }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${input.frame.frame_id}</title>
<style>
html, body { margin: 0; width: 100%; height: 100%; background: #eef0f2; color: #161922; font-family: Arial, "PingFang SC", "Microsoft YaHei", sans-serif; letter-spacing: 0; }
.stage { position: relative; width: 1080px; height: 1920px; overflow: hidden; background: #eef0f2; }
.top { position: absolute; top: 0; left: 0; right: 0; height: 166px; padding: 30px 42px 24px; box-sizing: border-box; display: grid; grid-template-columns: 58px 86px minmax(0, 1fr) 74px 58px; align-items: center; column-gap: 22px; background: #f7f7f8; border-bottom: 1px solid #dcdee2; }
.icon-button { position: relative; width: 58px; height: 58px; flex: 0 0 auto; box-sizing: border-box; }
.back::before { content: ""; position: absolute; left: 18px; top: 13px; width: 28px; height: 28px; border-left: 6px solid #11151d; border-bottom: 6px solid #11151d; border-radius: 3px; transform: rotate(45deg); }
.avatar-slot { position: relative; overflow: hidden; border-radius: 50%; flex: 0 0 auto; background: #d9dde3; box-shadow: inset 0 0 0 1px rgba(17, 21, 29, 0.06); }
.avatar-slot::after { content: ""; position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.28); pointer-events: none; }
.avatar-img { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; display: block; object-fit: cover; border-radius: inherit; }
.header-avatar { width: 86px; height: 86px; }
.message-avatar { width: 70px; height: 70px; margin-top: 2px; }
.title { min-width: 0; transform: translateY(1px); }
.name { color: #11151d; font-size: 42px; font-weight: 700; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.online { margin-top: 9px; color: #858894; font-size: 30px; line-height: 1; white-space: nowrap; }
.video-icon { width: 74px; height: 58px; }
.video-icon::before { content: ""; position: absolute; left: 4px; top: 13px; width: 43px; height: 29px; border: 6px solid #171b25; border-radius: 10px; box-sizing: border-box; }
.video-icon::after { content: ""; position: absolute; left: 45px; top: 20px; width: 18px; height: 18px; border-top: 6px solid #171b25; border-right: 6px solid #171b25; transform: rotate(45deg); border-radius: 3px; }
.more { display: flex; align-items: center; justify-content: center; gap: 8px; }
.more span { width: 7px; height: 7px; border-radius: 50%; background: #171b25; }
.chat { position: absolute; top: 176px; left: 32px; right: 32px; bottom: 232px; display: flex; flex-direction: column; gap: 28px; justify-content: flex-end; overflow: hidden; }
.time-marker { align-self: center; color: #858894; font-size: 32px; line-height: 1; margin: 4px 0 10px; }
.row { display: flex; align-items: flex-start; width: 100%; gap: 20px; }
.row.left { justify-content: flex-start; }
.row.right { justify-content: flex-end; }
.row.right .message-avatar { order: 2; }
.bubble { max-width: 646px; min-height: 66px; padding: 20px 34px 22px; border-radius: 21px; box-sizing: border-box; color: #fff; font-size: 40px; line-height: 1.28; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; box-shadow: 0 1px 1px rgba(0, 0, 0, 0.04); }
.left .bubble { background: #743df2; border-top-left-radius: 10px; }
.right .bubble { background: #1689ff; border-top-right-radius: 10px; }
.quick-actions { position: absolute; left: 22px; right: 22px; bottom: 132px; height: 78px; display: flex; gap: 16px; overflow: hidden; }
.chip { flex: 0 0 auto; height: 78px; padding: 0 29px; display: inline-flex; align-items: center; gap: 11px; border-radius: 19px; background: #fff; color: #151922; font-size: 31px; font-weight: 700; line-height: 1; white-space: nowrap; box-sizing: border-box; }
.chip-icon { font-size: 32px; line-height: 1; }
.composer { position: absolute; left: 22px; right: 22px; bottom: 22px; height: 94px; display: grid; grid-template-columns: 56px minmax(0, 1fr) 62px 62px 62px; align-items: center; gap: 25px; padding: 0 27px; box-sizing: border-box; border-radius: 20px; background: #fff; }
.grid-icon { width: 52px; height: 52px; display: grid; grid-template-columns: repeat(2, 21px); grid-template-rows: repeat(2, 21px); gap: 8px; }
.grid-icon span { border: 5px solid #171b25; border-radius: 8px; box-sizing: border-box; }
.placeholder { color: #858894; font-size: 35px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.round-icon { position: relative; width: 62px; height: 62px; border: 5px solid #171b25; border-radius: 50%; box-sizing: border-box; }
.voice-icon::before { content: ""; position: absolute; left: 18px; top: 23px; width: 8px; height: 8px; border-radius: 50%; background: #171b25; }
.voice-icon::after { content: ""; position: absolute; left: 24px; top: 15px; width: 17px; height: 28px; border-right: 5px solid #171b25; border-radius: 50%; }
.voice-icon span { position: absolute; left: 13px; top: 18px; width: 19px; height: 20px; border-right: 5px solid #171b25; border-radius: 50%; }
.smile-icon::before { content: ""; position: absolute; left: 16px; top: 18px; width: 7px; height: 7px; border-radius: 50%; background: #171b25; box-shadow: 18px 0 0 #171b25; }
.smile-icon::after { content: ""; position: absolute; left: 17px; top: 32px; width: 24px; height: 12px; border-bottom: 5px solid #171b25; border-radius: 0 0 24px 24px; }
.plus-icon::before, .plus-icon::after { content: ""; position: absolute; left: 17px; top: 26px; width: 28px; height: 5px; border-radius: 5px; background: #171b25; }
.plus-icon::after { transform: rotate(90deg); }
</style>
</head>
<body>
<main class="stage" data-douyin-chat-shell>
  <header class="top" aria-label="抖音私信页头部">
    <div class="icon-button back" aria-hidden="true"></div>
    <div class="avatar-slot header-avatar avatar-left avatar-contact" data-avatar-role="contact" aria-hidden="true">${avatarImg(uiProfile.contactAvatarSrc)}</div>
    <div class="title"><div class="name">${escapeHtml(headerTitle)}</div><div class="online">${escapeHtml(uiProfile.contactStatus)}</div></div>
    <div class="icon-button video-icon" aria-hidden="true"></div>
    <div class="icon-button more" aria-hidden="true"><span></span><span></span><span></span></div>
  </header>
  <section class="chat" aria-label="聊天消息">
    <div class="time-marker">刚刚</div>
${messages.map((message) => `    <div class="row ${message.side}"><div class="avatar-slot message-avatar avatar-${message.side}" data-avatar-role="${message.side}-speaker" aria-hidden="true">${avatarImg(message.side === "left" ? uiProfile.leftAvatarSrc : uiProfile.rightAvatarSrc)}</div><div class="bubble" data-message-id="${message.id}">${escapeHtml(message.display_text)}</div></div>`).join("\n")}
  </section>
  <div class="quick-actions" aria-hidden="true"><div class="chip"><span class="chip-icon">☺</span><span>打招呼</span></div><div class="chip"><span class="chip-icon">龙</span><span>端午快乐</span></div><div class="chip"><span class="chip-icon">♡</span><span>比心</span></div><div class="chip"><span class="chip-icon">👍</span><span>赞</span></div><div class="chip"><span class="chip-icon">笑</span><span>捂脸</span></div></div>
  <div class="composer" aria-hidden="true"><div class="grid-icon"><span></span><span></span><span></span><span></span></div><div class="placeholder">发消息或按住说话...</div><div class="round-icon voice-icon"><span></span></div><div class="round-icon smile-icon"></div><div class="round-icon plus-icon"></div></div>
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
}

export function validateChatFrameHtml(html: string): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (/https?:\/\//.test(html)) issues.push("chat frame html must not reference remote resources");
  if (!html.includes("qivance-chat-data")) issues.push("chat frame html must embed qivance-chat-data");
  if (!/overflow-wrap:\s*anywhere/.test(html)) issues.push("chat frame html must include long-text wrapping");
  if (!html.includes("data-douyin-chat-shell")) issues.push("chat frame html must render the v7 Douyin-style shell");
  if (/class="status-bar"|15:30|battery/.test(html)) issues.push("chat frame html must not include a phone status bar");
  if (!/class="icon-button back"/.test(html)) issues.push("chat frame html must include a CSS-drawn back icon slot");
  if (!/class="avatar-slot header-avatar/.test(html)) issues.push("chat frame html must include a replaceable header avatar slot");
  if (!/data-avatar-role="contact"/.test(html)) issues.push("chat frame html must expose a contact avatar slot");
  if (!/class="quick-actions"/.test(html)) issues.push("chat frame html must include quick action chips");
  if (!/class="composer"/.test(html)) issues.push("chat frame html must include the bottom input composer");
  if (!/class="avatar-slot message-avatar /.test(html)) issues.push("chat frame html must include replaceable message avatar slots");
  if (/letter-spacing:\s*-/.test(html)) issues.push("chat frame html must not use negative letter spacing");
  return { ok: issues.length === 0, issues };
}

function chatFrameUiProfile(conversationPlan: ConversationPlan): {
  contactName: string;
  contactStatus: string;
  contactAvatarSrc?: string;
  leftAvatarSrc?: string;
  rightAvatarSrc?: string;
} {
  const ui = (conversationPlan as ConversationPlan & { chat_ui?: ChatFrameUiProfile }).chat_ui ?? {};
  return {
    contactName: nonEmpty(ui.contact_name) ?? "蒲涛",
    contactStatus: nonEmpty(ui.contact_status) ?? "今天在线",
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

function avatarImg(src: string | undefined): string {
  return src ? `<img class="avatar-img" src="${escapeHtml(src)}" alt="">` : "";
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
