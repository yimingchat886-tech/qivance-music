import assert from "node:assert/strict";
import test from "node:test";
import { buildChatAnimationPlan } from "../src/lib/chat-dialogue/chat-animation-plan.ts";
import { buildChatFrameContracts, validateChatFrameContracts } from "../src/lib/chat-dialogue/chat-frame-contracts.ts";
import { renderChatFrameHtml, validateChatFrameHtml } from "../src/lib/chat-dialogue/chat-frame-html.ts";
import { buildConversationPlan } from "../src/lib/chat-dialogue/conversation-plan.ts";
import { buildLyricsLineMap } from "../src/lib/chat-dialogue/lyrics-line-map.ts";
import { buildSpeakerAttribution } from "../src/lib/chat-dialogue/speaker-attribution.ts";

test("builds local-only chat frame contracts and HTML", () => {
  const conversationPlan = conversationFixture();
  const animationPlan = buildChatAnimationPlan({ conversationPlan, durationSec: 4 });
  const frameContracts = buildChatFrameContracts({
    projectId: "demo_project",
    conversationPlan,
    animationPlan,
  });

  assert.equal(validateChatFrameContracts({ conversationPlan, frameContracts }).ok, true);
  assert.equal(frameContracts.frames[0]?.html_path, "video/html-video/.html-video/projects/demo_project/frames/chat_dialogue_mv_001.html");
  assert.equal(frameContracts.frames.reduce((sum, frame) => sum + frame.duration_sec, 0), 4);

  const html = renderChatFrameHtml({ frame: frameContracts.frames[0]!, conversationPlan });
  const validation = validateChatFrameHtml(html);
  assert.equal(validation.ok, true, validation.issues.join("\n"));
  assert.match(html, /hello world\?/);
  assert.match(html, /<div class="name">蒲涛<\/div>/);
  assert.doesNotMatch(html, /对方正在输入/);
  assert.match(html, /data-douyin-chat-shell/);
  assert.doesNotMatch(html, /class="status-bar"|15:30|battery/);
  assert.match(html, /class="icon-button back"/);
  assert.match(html, /class="avatar-slot header-avatar avatar-left avatar-contact"/);
  assert.match(html, /data-avatar-role="contact"/);
  assert.match(html, /class="avatar-slot message-avatar avatar-left"/);
  assert.match(html, /class="avatar-slot message-avatar avatar-right"/);
  assert.match(html, /class="quick-actions"/);
  assert.match(html, /打招呼/);
  assert.match(html, /端午快乐/);
  assert.match(html, /class="composer"/);
  assert.match(html, /class="round-icon voice-icon"/);
  assert.match(html, /class="round-icon smile-icon"/);
  assert.match(html, /class="round-icon plus-icon"/);
  assert.match(html, /发消息或按住说话/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("uses configurable contact profile and typing title for newly visible left messages", () => {
  const conversationPlan = conversationFixture();
  const customPlan = {
    ...conversationPlan,
    chat_ui: {
      contact_name: "林同学",
      contact_status: "在线",
      contact_avatar_src: "../assets/avatars/contact.png",
      left_avatar_src: "../assets/avatars/left.png",
      right_avatar_src: "../assets/avatars/right.png",
    },
  };

  const rightHtml = renderChatFrameHtml({
    frame: {
      frame_id: "custom_right_frame",
      html_path: "video/html-video/.html-video/projects/demo_project/frames/custom_right_frame.html",
      duration_sec: 1,
      section_ids: ["sec_001"],
      message_ids: ["msg_001", "msg_002"],
      text_policy: "verbatim_lyrics",
      forbidden_remote_resources: true,
    },
    conversationPlan: customPlan,
  });
  assert.match(rightHtml, /<div class="name">林同学<\/div>/);
  assert.doesNotMatch(rightHtml, /对方正在输入/);
  assert.match(rightHtml, /src="\.\.\/assets\/avatars\/contact\.png"/);
  assert.match(rightHtml, /src="\.\.\/assets\/avatars\/left\.png"/);
  assert.match(rightHtml, /src="\.\.\/assets\/avatars\/right\.png"/);

  const leftHtml = renderChatFrameHtml({
    frame: {
      frame_id: "custom_left_frame",
      html_path: "video/html-video/.html-video/projects/demo_project/frames/custom_left_frame.html",
      duration_sec: 1,
      section_ids: ["sec_001"],
      message_ids: ["msg_001"],
      text_policy: "verbatim_lyrics",
      forbidden_remote_resources: true,
    },
    conversationPlan: customPlan,
  });
  assert.match(leftHtml, /<div class="name">对方正在输入\.\.\.\.<\/div>/);
  assert.doesNotMatch(leftHtml, /<div class="name">林同学<\/div>/);
  assert.match(leftHtml, /data-message-id="msg_001"/);
});

test("rejects frame contracts that do not cover all messages", () => {
  const conversationPlan = conversationFixture();
  const animationPlan = buildChatAnimationPlan({ conversationPlan, durationSec: 4 });
  const frameContracts = buildChatFrameContracts({ projectId: "demo_project", conversationPlan, animationPlan });
  frameContracts.frames[0]!.message_ids = ["msg_001"];

  const validation = validateChatFrameContracts({ conversationPlan, frameContracts });

  assert.equal(validation.ok, false);
  assert.match(validation.issues.join("\n"), /msg_002/);
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
