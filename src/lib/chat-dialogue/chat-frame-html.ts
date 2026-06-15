import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatFrameContract } from "./chat-frame-contracts.ts";
import type { ConversationPlan } from "./conversation-plan.ts";

export function renderChatFrameHtml(input: {
  frame: ChatFrameContract;
  conversationPlan: ConversationPlan;
}): string {
  const messages = input.conversationPlan.messages.filter((message) => input.frame.message_ids.includes(message.id));
  const payload = JSON.stringify({ frame: input.frame, messages }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${input.frame.frame_id}</title>
<style>
html, body { margin: 0; width: 100%; height: 100%; background: #111; color: #f8f8f8; font-family: Arial, sans-serif; letter-spacing: 0; }
.stage { position: relative; width: 1080px; height: 1920px; overflow: hidden; background: #151515; }
.top { height: 116px; display: flex; align-items: center; justify-content: center; border-bottom: 1px solid #333; font-size: 34px; }
.chat { position: absolute; inset: 140px 54px 160px; display: flex; flex-direction: column; gap: 28px; justify-content: flex-end; }
.row { display: flex; width: 100%; }
.row.left { justify-content: flex-start; }
.row.right { justify-content: flex-end; }
.bubble { max-width: 690px; padding: 24px 30px; border-radius: 8px; font-size: 38px; line-height: 1.32; overflow-wrap: anywhere; word-break: break-word; }
.left .bubble { background: #2e2e34; }
.right .bubble { background: #0d7a5f; }
.bottom { position: absolute; left: 54px; right: 54px; bottom: 44px; height: 82px; border: 1px solid #3d3d3d; border-radius: 8px; }
</style>
</head>
<body>
<main class="stage">
  <div class="top">Qivance Chat MV</div>
  <section class="chat">
${messages.map((message) => `    <div class="row ${message.side}"><div class="bubble" data-message-id="${message.id}">${escapeHtml(message.display_text)}</div></div>`).join("\n")}
  </section>
  <div class="bottom"></div>
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
  if (/letter-spacing:\s*-/.test(html)) issues.push("chat frame html must not use negative letter spacing");
  return { ok: issues.length === 0, issues };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}
