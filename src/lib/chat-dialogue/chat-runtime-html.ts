import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stageChatUiAssets } from "./chat-assets.ts";
import type { ChatAnimationPlan } from "./chat-animation-plan.ts";
import type { ConversationPlan } from "./conversation-plan.ts";
import type { ChatRuntimeTimeline } from "./chat-runtime-timeline.ts";

type ResolvedRuntimeUiProfile = {
  contactName: string;
  contactStatus: string;
  contactAvatarSrc: string;
  leftAvatarSrc: string;
  rightAvatarSrc: string;
};

const STATUS_ICON_BASE = "../assets/status_bar_icons/";
const STATUS_ICON_FILES = ["back_arrow.png", "online_dot.png", "video_camera.png", "more_ellipsis.png"] as const;

export function renderChatRuntimeHtml(input: {
  conversationPlan: ConversationPlan;
  animationPlan: ChatAnimationPlan;
  runtimeTimeline: ChatRuntimeTimeline;
}): string {
  const uiProfile = runtimeUiProfile(input.conversationPlan);
  const runtimeData = JSON.stringify({
    conversationPlan: input.conversationPlan,
    animationPlan: input.animationPlan,
    runtimeTimeline: input.runtimeTimeline,
    ui: uiProfile,
  }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1080, initial-scale=1">
<title>chat_dialogue_mv runtime</title>
<style>
:root {
  --right-bubble-in: ${input.runtimeTimeline.css_motion.right_bubble_ms}ms;
  --left-bubble-in: ${input.runtimeTimeline.css_motion.left_bubble_ms}ms;
  --read-in: ${input.runtimeTimeline.css_motion.receipt_in_ms}ms;
  --read-out: ${input.runtimeTimeline.css_motion.receipt_out_ms}ms;
  --status-swap: ${input.runtimeTimeline.css_motion.header_swap_ms}ms;
  --bubble-ease: cubic-bezier(.16, 1, .3, 1);
  --soft-ease: cubic-bezier(.2, .8, .2, 1);
}
html, body { margin: 0; width: 100%; height: 100%; background: #efefef; color: #161823; font-family: Arial, "PingFang SC", "Microsoft YaHei", sans-serif; letter-spacing: 0; }
.stage { position: relative; width: 1080px; height: 1920px; overflow: hidden; background: #efefef; }
.top { position: absolute; top: 0; left: 0; right: 0; height: 150px; background: #efefef; border-bottom: 1px solid #d5d5d7; box-sizing: border-box; }
.top-icon { position: absolute; display: block; object-fit: contain; user-select: none; pointer-events: none; }
.back-icon { left: 47px; top: 63px; width: 30px; height: 48px; }
.video-icon-img { right: 140px; top: 57px; width: 55px; height: 55px; }
.more-icon-img { right: 43px; top: 69px; width: 53px; height: 13px; }
.header-avatar-wrap { position: absolute; left: 125px; top: 39px; width: 104px; height: 104px; }
.header-avatar { width: 104px; height: 104px; }
.online-dot { position: absolute; right: -3px; bottom: 0; width: 40px; height: 37px; display: block; }
.avatar-slot { position: relative; overflow: hidden; border-radius: 50%; flex: 0 0 auto; background: #bfbfbf; }
.avatar-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.title { position: absolute; left: 249px; right: 250px; top: 49px; min-width: 0; height: 86px; }
.title-slot { position: relative; height: 48px; line-height: 48px; }
.peer-name, .typing-name { position: absolute; left: 0; top: 0; max-width: 100%; color: #161823; font-size: 38px; font-weight: 700; line-height: 48px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: opacity var(--status-swap) ease-out, transform var(--status-swap) ease-out; }
.peer-name { opacity: 1; transform: translate3d(0, 0, 0); }
.typing-name { opacity: 0; transform: translate3d(0, 4px, 0); }
.chat-header.is-typing .peer-name { opacity: 0; transform: translate3d(0, -4px, 0); }
.chat-header.is-typing .typing-name { opacity: 1; transform: translate3d(0, 0, 0); }
.online { position: absolute; left: 0; right: 0; top: 48px; color: #6d6e75; font-size: 29px; font-weight: 400; line-height: 36px; white-space: nowrap; }
.safety-notice { position: absolute; left: 126px; right: 126px; top: 199px; color: #6d6e75; font-size: 33px; font-weight: 400; line-height: 48px; text-align: center; }
.time-marker { color: #6d6e75; font-size: 32px; font-weight: 400; line-height: 38px; text-align: center; }
.top-time { position: absolute; left: 0; right: 0; top: 338px; }
.chat { position: absolute; left: 40px; right: 40px; top: 412px; bottom: 58px; display: flex; flex-direction: column; gap: 22px; justify-content: flex-start; overflow: hidden; }
.row { display: flex; align-items: flex-start; gap: 18px; min-width: 0; }
.row.is-hidden { display: none; }
.row.left { justify-content: flex-start; }
.row.right { justify-content: flex-end; }
.row.right .message-avatar { order: 2; }
.row.entering .bubble { animation: bubbleFloatPop var(--bubble-in) var(--bubble-ease) both; will-change: transform, opacity; }
.row.entering .message-avatar { animation: avatarSoftIn 180ms var(--soft-ease) both; will-change: transform, opacity; }
.row.right.entering .bubble { --bubble-in: var(--right-bubble-in); transform-origin: right bottom; }
.row.left.entering .bubble { --bubble-in: var(--left-bubble-in); transform-origin: left bottom; }
.bubble-stack { display: flex; flex-direction: column; align-items: flex-start; }
.row.right .bubble-stack { align-items: flex-end; }
.message-avatar { width: 104px; height: 104px; }
.bubble { max-width: 710px; box-sizing: border-box; border-radius: 20px; padding: 28px 32px; font-size: 38px; font-weight: 400; line-height: 54px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; box-shadow: 0 1px 2px rgba(0,0,0,.03); }
.left .bubble { background: #ffffff; color: #161823; }
.right .bubble { background: #4f7aff; color: #ffffff; }
.read-receipt { min-height: 36px; margin-top: 18px; display: inline-flex; align-items: center; gap: 8px; color: #777982; font-size: 30px; line-height: 36px; opacity: 0; visibility: hidden; transform: translate3d(0, -2px, 0); will-change: transform, opacity; }
.row.right.read-in .read-receipt { visibility: visible; animation: receiptIn var(--read-in) var(--soft-ease) 40ms both; }
.row.right.read-on .read-receipt { opacity: 1; visibility: visible; transform: translate3d(0, 0, 0); }
.row.right.read-out .read-receipt { visibility: visible; animation: receiptOut var(--read-out) ease-in both; }
.receipt-avatar { width: 38px; height: 38px; }
@keyframes bubbleFloatPop {
  0% { opacity: 0; transform: translate3d(0, 18px, 0) scale(.965); }
  56% { opacity: 1; transform: translate3d(0, -2px, 0) scale(1.018); }
  82% { transform: translate3d(0, .5px, 0) scale(.998); }
  100% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
}
@keyframes avatarSoftIn {
  0% { opacity: 0; transform: translate3d(0, 8px, 0) scale(.96); }
  100% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
}
@keyframes receiptIn {
  0% { opacity: 0; transform: translate3d(0, -2px, 0); }
  100% { opacity: 1; transform: translate3d(0, 0, 0); }
}
@keyframes receiptOut {
  0% { opacity: 1; visibility: visible; transform: translate3d(0, 0, 0); }
  99% { visibility: visible; }
  100% { opacity: 0; visibility: hidden; transform: translate3d(0, -2px, 0); }
}
</style>
</head>
<body>
<main class="stage" data-douyin-chat-shell>
  <header class="top chat-header" id="chatHeader">
    <img class="top-icon back-icon" src="${escapeHtml(statusIcon("back_arrow.png"))}" aria-hidden="true" alt="">
    <div class="header-avatar-wrap" data-avatar-role="contact" aria-hidden="true"><div class="avatar-slot header-avatar">${avatarImg(uiProfile.contactAvatarSrc)}</div><img class="online-dot" src="${escapeHtml(statusIcon("online_dot.png"))}" alt=""></div>
    <div class="title"><div class="title-slot"><span class="peer-name">${escapeHtml(uiProfile.contactName)}</span><span class="typing-name">对方正在输入....</span></div><div class="online">${escapeHtml(uiProfile.contactStatus)}</div></div>
    <img class="top-icon video-icon-img" src="${escapeHtml(statusIcon("video_camera.png"))}" aria-hidden="true" alt="">
    <img class="top-icon more-icon-img" src="${escapeHtml(statusIcon("more_ellipsis.png"))}" aria-hidden="true" alt="">
  </header>
  <div class="safety-notice" aria-hidden="true">为保障用户沟通安全，平台会打击诈骗等违法违规内容</div>
  <div class="time-marker top-time" aria-hidden="true">15:31</div>
  <section class="chat" id="chatList" aria-label="聊天消息">
${input.conversationPlan.messages.map((message) => messageRowHtml(message, uiProfile)).join("\n")}
  </section>
</main>
<script type="application/json" id="qivance-chat-runtime-data">${runtimeData}</script>
<script>
(() => {
  const data = JSON.parse(document.getElementById("qivance-chat-runtime-data").textContent);
  const timeline = data.runtimeTimeline;
  const rows = new Map(Array.from(document.querySelectorAll("[data-message-id]")).map((row) => [row.dataset.messageId, row]));
  let stopped = false;
  let started = false;
  let runtimeStartMs = 0;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ready = Promise.all([
    document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve(),
    waitForImages(),
  ]).then(() => {
    document.body.dataset.ready = "true";
  });

  function waitForImages() {
    return Promise.all(Array.from(document.images).map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      });
    }));
  }

  function waitUntil(targetMs) {
    return wait(Math.max(0, targetMs - (performance.now() - runtimeStartMs)));
  }

  function waitAnimationEnd(el) {
    return new Promise((resolve) => {
      el.addEventListener("animationend", resolve, { once: true });
    });
  }

  function getRow(messageId) {
    const row = rows.get(messageId);
    if (!row) throw new Error("missing row " + messageId);
    return row;
  }

  async function enterMessage(row) {
    row.classList.remove("is-hidden");
    void row.offsetWidth;
    row.classList.add("entering");
    await waitAnimationEnd(row.querySelector(".bubble"));
    row.classList.remove("entering");
    row.classList.add("entered");
  }

  async function showReadReceipt(row) {
    row.classList.remove("read-out");
    row.classList.add("read-in");
    await wait(timeline.css_motion.receipt_in_ms + 50);
    row.classList.remove("read-in");
    row.classList.add("read-on");
  }

  async function hideReadReceipt(row) {
    row.classList.remove("read-in", "read-on");
    row.classList.add("read-out");
    await wait(timeline.css_motion.receipt_out_ms + 10);
    row.classList.remove("read-out");
  }

  function setTypingStatus(isTyping) {
    document.getElementById("chatHeader").classList.toggle("is-typing", isTyping);
  }

  function seekTimeline(timeSec) {
    const events = timeline.events.filter((event) => event.type === "message");
    const hiddenReceipts = new Set(events
      .filter((event) => event.hide_receipt_message_id && timeSec >= event.at_sec)
      .map((event) => event.hide_receipt_message_id));
    setTypingStatus(events.some((event) => event.side === "left" && timeSec >= event.at_sec && timeSec < event.at_sec + 0.4));
    for (const event of events) {
      const row = getRow(event.message_id);
      row.classList.remove("entering", "entered", "read-in", "read-on", "read-out");
      if (timeSec < event.at_sec) {
        row.classList.add("is-hidden");
        continue;
      }
      row.classList.remove("is-hidden");
      row.classList.add("entered");
      if (event.show_receipt_after_enter && !hiddenReceipts.has(event.message_id)) {
        const receiptAtSec = event.at_sec + ((event.side === "right" ? timeline.css_motion.right_bubble_ms : timeline.css_motion.left_bubble_ms) + 40 + timeline.css_motion.receipt_in_ms) / 1000;
        if (timeSec >= receiptAtSec) row.classList.add("read-on");
      }
    }
  }

  async function playRightMessage(event) {
    const row = getRow(event.message_id);
    await enterMessage(row);
    if (event.show_receipt_after_enter) {
      await wait(40);
      await showReadReceipt(row);
    }
  }

  async function playLeftMessage(event) {
    if (event.hide_receipt_message_id) void hideReadReceipt(getRow(event.hide_receipt_message_id));
    setTypingStatus(true);
    await wait(event.enter_delay_ms || timeline.css_motion.left_enter_delay_ms);
    await enterMessage(getRow(event.message_id));
    setTypingStatus(false);
  }

  async function playTimeline() {
    if (started) return;
    await ready;
    started = true;
    stopped = false;
    runtimeStartMs = performance.now();
    for (const event of timeline.events) {
      if (stopped || event.type === "end") break;
      await waitUntil(event.at_sec * 1000);
      if (event.side === "right") void playRightMessage(event);
      else void playLeftMessage(event);
    }
    await waitUntil(timeline.duration_sec * 1000);
    document.body.dataset.playbackDone = "true";
  }

  window.__qivanceChatRuntime = {
    ready,
    play: playTimeline,
    seek: seekTimeline,
    stop() { stopped = true; },
    getState() { return { started, stopped, playbackDone: document.body.dataset.playbackDone === "true" }; },
    durationMs: Math.ceil(timeline.duration_sec * 1000),
  };
})();
</script>
</body>
</html>`;
}

export async function writeChatRuntimeHtml(input: {
  projectRoot: string;
  projectId: string;
  html: string;
}): Promise<{ path: string }> {
  const relativePath = `video/html-video/.html-video/projects/${input.projectId}/runtime/chat_dialogue_mv.html`;
  const projectDir = path.join(input.projectRoot, `video/html-video/.html-video/projects/${input.projectId}`);
  const htmlPath = path.join(input.projectRoot, relativePath);
  await mkdir(path.dirname(htmlPath), { recursive: true });
  await stageChatUiAssets(projectDir);
  await writeFile(htmlPath, input.html, "utf8");
  return { path: relativePath };
}

export function validateChatRuntimeHtml(html: string): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (/https?:\/\//i.test(html)) issues.push("chat runtime html must not reference remote URLs");
  if (/@import/i.test(html)) issues.push("chat runtime html must not import external stylesheets");
  if (!html.includes("qivance-chat-runtime-data")) issues.push("chat runtime html must embed qivance-chat-runtime-data");
  if (!html.includes("data-douyin-chat-shell")) issues.push("chat runtime html must render the Douyin chat shell");
  if (!/data-message-id="msg_/.test(html)) issues.push("chat runtime html must render message rows with data-message-id");
  if (!/class="row (?:left|right) is-hidden"/.test(html)) issues.push("chat runtime html message rows must start hidden");
  if (!/class="peer-name"/.test(html) || !/class="typing-name"/.test(html)) issues.push("chat runtime html must include peer and typing title slots");
  for (const token of ["bubbleFloatPop", "avatarSoftIn", "receiptIn", "receiptOut"]) {
    if (!html.includes(token)) issues.push(`chat runtime html must include ${token}`);
  }
  for (const token of ["playTimeline", "seekTimeline", "enterMessage", "animationend", "classList"]) {
    if (!html.includes(token)) issues.push(`chat runtime html script must include ${token}`);
  }
  if (!/overflow-wrap:\s*anywhere/.test(html)) issues.push("chat runtime html must include long-text wrapping");
  if (/read-out[\s\S]{0,200}display\s*:\s*none/i.test(html)) issues.push("chat runtime html must not hide receipt read-out with display:none");
  if (/class="row right/.test(html) && (!/class="receipt-avatar avatar-slot"/.test(html) || !/src="\.\.\/assets\/avatars\//.test(html))) {
    issues.push("chat runtime html receipt avatar must use the contact avatar");
  }
  if (!/data-avatar-role="contact"/.test(html)) issues.push("chat runtime html must expose a contact avatar role");
  if (/class="row left/.test(html) && !/data-avatar-role="left-speaker"/.test(html)) issues.push("chat runtime html must expose left speaker avatar roles");
  if (/class="row right/.test(html) && !/data-avatar-role="right-speaker"/.test(html)) issues.push("chat runtime html must expose right speaker avatar roles");
  if (/letter-spacing:\s*-/.test(html)) issues.push("chat runtime html must not use negative letter spacing");
  return { ok: issues.length === 0, issues };
}

function runtimeUiProfile(conversationPlan: ConversationPlan): ResolvedRuntimeUiProfile {
  const ui = conversationPlan.chat_ui ?? {};
  return {
    contactName: nonEmpty(ui.contact_name) ?? "蒲涛",
    contactStatus: nonEmpty(ui.contact_status) ?? "在线",
    contactAvatarSrc: nonEmpty(ui.contact_avatar_src) ?? "../assets/avatars/1.jpg",
    leftAvatarSrc: nonEmpty(ui.left_avatar_src) ?? "../assets/avatars/1.jpg",
    rightAvatarSrc: nonEmpty(ui.right_avatar_src) ?? "../assets/avatars/2.jpg",
  };
}

function messageRowHtml(message: ConversationPlan["messages"][number], uiProfile: ResolvedRuntimeUiProfile): string {
  const side = message.side;
  const avatarSrc = side === "left" ? uiProfile.leftAvatarSrc : uiProfile.rightAvatarSrc;
  const receipt = side === "right"
    ? `<div class="read-receipt" aria-hidden="true"><span class="receipt-text">已读</span><span class="receipt-avatar avatar-slot">${avatarImg(uiProfile.leftAvatarSrc)}</span></div>`
    : "";
  if (side === "right") {
    return `    <div class="row right is-hidden" data-message-id="${escapeHtml(message.id)}"><div class="bubble-stack"><div class="bubble bubble-right">${escapeHtml(message.display_text)}</div>${receipt}</div><div class="avatar-slot message-avatar avatar-right" data-avatar-role="right-speaker" aria-hidden="true">${avatarImg(avatarSrc)}</div></div>`;
  }
  return `    <div class="row left is-hidden" data-message-id="${escapeHtml(message.id)}"><div class="avatar-slot message-avatar avatar-left" data-avatar-role="left-speaker" aria-hidden="true">${avatarImg(avatarSrc)}</div><div class="bubble-stack"><div class="bubble bubble-left">${escapeHtml(message.display_text)}</div></div></div>`;
}

function statusIcon(fileName: string): string {
  return `${STATUS_ICON_BASE}${fileName}`;
}

function avatarImg(src: string): string {
  return `<img class="avatar-img" src="${escapeHtml(src)}" alt="">`;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
