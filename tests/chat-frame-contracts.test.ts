import assert from "node:assert/strict";
import { access, lstat, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildChatAnimationPlan } from "../src/lib/chat-dialogue/chat-animation-plan.ts";
import { buildChatFrameContracts, validateChatFrameContracts, type ChatFrameUiState } from "../src/lib/chat-dialogue/chat-frame-contracts.ts";
import { renderChatFrameHtml, validateChatFrameHtml, writeChatFrameHtml } from "../src/lib/chat-dialogue/chat-frame-html.ts";
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
  assert.equal(totalDuration(frameContracts.frames), 4);
  assert.equal(frameContracts.frames.every((frame) => frame.duration_sec > 0), true);
  assert.equal(frameContracts.frames.some((frame) => frame.message_ids.includes("msg_001")), true);
  assert.equal(frameContracts.frames.some((frame) => frame.message_ids.includes("msg_002")), true);
  assert.equal(frameContracts.frames.every((frame) => frame.ui_state.header), true);

  const rightEnteringFrames = frameContracts.frames.filter((frame) => frame.ui_state.entering_message_id === "msg_001");
  assert.ok(rightEnteringFrames.length > 1);
  assertMonotonic(rightEnteringFrames.map((frame) => frame.ui_state.enter_progress ?? -1));
  assert.ok(rightEnteringFrames.every((frame) => (frame.ui_state.enter_progress ?? -1) >= 0 && (frame.ui_state.enter_progress ?? 2) <= 1));

  const receiptStates = statesForReceipt(frameContracts.frames, "msg_001");
  assert.deepEqual(receiptStates, ["hidden", "in", "on", "out", "hidden"]);

  const timedFrames = withStartTimes(frameContracts.frames);
  const firstLeftPopFrame = timedFrames.find(({ frame }) => frame.ui_state.entering_message_id === "msg_002" && (frame.ui_state.enter_progress ?? 0) > 0);
  assert.ok(firstLeftPopFrame);
  assert.ok(Math.abs(firstLeftPopFrame.startSec - 1.54) <= 1 / 30 + 0.001);
  assert.ok(frameContracts.frames.some((frame) => frame.ui_state.header.phase === "typing-in"));
  assert.ok(frameContracts.frames.some((frame) => frame.ui_state.header.phase === "typing-on"));
  assert.ok(frameContracts.frames.some((frame) => frame.ui_state.header.phase === "typing-out"));
  assert.equal(frameContracts.frames.at(-1)?.ui_state.header.phase, "default");

  const preLyricHtml = renderChatFrameHtml({ frame: frameContracts.frames[0]!, conversationPlan });
  const preLyricValidation = validateChatFrameHtml(preLyricHtml);
  assert.equal(preLyricValidation.ok, true, preLyricValidation.issues.join("\n"));
  assert.doesNotMatch(preLyricHtml, /data-message-id=/);

  const html = renderChatFrameHtml({ frame: frameContracts.frames.find((frame) => frame.ui_state.read_receipt?.state === "on")!, conversationPlan });
  const validation = validateChatFrameHtml(html);
  assert.equal(validation.ok, true, validation.issues.join("\n"));
  assert.match(html, /hello world\?/);
  assert.match(html, /class="name title-name peer-name">蒲涛<\/div>/);
  assert.match(html, /class="name title-name typing-name">对方正在输入\.\.\.\.<\/div>/);
  assert.match(html, /data-douyin-chat-shell/);
  assert.doesNotMatch(html, /class="status-bar"|15:30|battery/);
  assert.match(html, /@keyframes bubbleFloatPop/);
  assert.match(html, /animation-play-state:\s*paused/);
  assert.match(html, /\.\.\/assets\/status_bar_icons\/back_arrow\.png/);
  assert.match(html, /\.\.\/assets\/status_bar_icons\/avatar_online\.png/);
  assert.match(html, /\.\.\/assets\/status_bar_icons\/video_camera\.png/);
  assert.match(html, /\.\.\/assets\/status_bar_icons\/more_ellipsis\.png/);
  assert.match(html, /class="header-avatar-wrap"/);
  assert.match(html, /data-avatar-role="contact"/);
  assert.match(html, /class="avatar-slot message-avatar avatar-right"/);
  const leftVisibleHtml = renderChatFrameHtml({ frame: frameContracts.frames.find((frame) => frame.message_ids.includes("msg_002"))!, conversationPlan });
  assert.match(leftVisibleHtml, /class="avatar-slot message-avatar avatar-left"/);
  assert.doesNotMatch(html, /safety-notice|为保障用户沟通安全|为保证用户安全/);
  assert.match(html, />15:31</);
  assert.match(html, /justify-content:\s*flex-start/);
  assert.match(html, /background:\s*#ffffff/);
  assert.match(html, /background:\s*#4f7aff/);
  assert.match(html, /class="read-receipt receipt-on"/);
  assert.match(html, /class="receipt-avatar avatar-slot"><img class="avatar-img" src="\.\.\/assets\/avatars\/1\.jpg"/);
  assert.doesNotMatch(html, /quick-actions|composer|发消息或按住说话/);
  assert.doesNotMatch(html, /#743df2|#1689ff/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("uses configurable contact profile and typing title for newly visible left messages", () => {
  const conversationPlan = conversationFixture();
  const customPlan = {
    ...conversationPlan,
    chat_ui: {
      contact_name: "林同学",
      contact_status: "在线",
      contact_avatar_src: "../assets/avatars/1.jpg",
      left_avatar_src: "../assets/avatars/1.jpg",
      right_avatar_src: "../assets/avatars/2.jpg",
    },
  };

  const rightHtml = renderChatFrameHtml({
    frame: {
      frame_id: "custom_right_frame",
      html_path: "video/html-video/.html-video/projects/demo_project/frames/custom_right_frame.html",
      duration_sec: 1,
      section_ids: ["sec_001"],
      message_ids: ["msg_001"],
      ui_state: { header: { phase: "default" } },
      text_policy: "verbatim_lyrics",
      forbidden_remote_resources: true,
    },
    conversationPlan: customPlan,
  });
  assert.match(rightHtml, /class="title title-slot header-default"/);
  assert.match(rightHtml, /class="name title-name peer-name">林同学<\/div>/);
  assert.match(rightHtml, /class="name title-name typing-name">对方正在输入\.\.\.\.<\/div>/);
  assert.match(rightHtml, /src="\.\.\/assets\/avatars\/1\.jpg"/);
  assert.match(rightHtml, /src="\.\.\/assets\/avatars\/2\.jpg"/);
  assert.equal(readReceiptCount(rightHtml), 0);

  const leftHtml = renderChatFrameHtml({
    frame: {
      frame_id: "custom_left_frame",
      html_path: "video/html-video/.html-video/projects/demo_project/frames/custom_left_frame.html",
      duration_sec: 1,
      section_ids: ["sec_001"],
      message_ids: ["msg_001", "msg_002"],
      ui_state: {
        header: { phase: "typing-on", progress: 1 },
        read_receipt: { message_id: "msg_001", state: "out", progress: 0 },
      },
      text_policy: "verbatim_lyrics",
      forbidden_remote_resources: true,
    },
    conversationPlan: customPlan,
  });
  assert.match(leftHtml, /class="title title-slot header-typing-on"/);
  assert.match(leftHtml, /class="name title-name peer-name">林同学<\/div>/);
  assert.match(leftHtml, /class="name title-name typing-name">对方正在输入\.\.\.\.<\/div>/);
  assert.match(leftHtml, /data-message-id="msg_002"/);
  assert.equal(readReceiptCount(leftHtml), 1);
  assert.match(leftHtml, /class="read-receipt receipt-out"/);
  assert.match(leftHtml, /class="receipt-avatar avatar-slot"><img class="avatar-img" src="\.\.\/assets\/avatars\/1\.jpg"/);
});

test("renders read receipts by visible answer state and writes local assets", async () => {
  const conversationPlan = conversationFixture();
  const rightQuestion2 = { ...conversationPlan.messages[0]!, id: "custom_right_1", display_text: "第二个问题?", raw_text: "第二个问题?", start_sec: 3.2, end_sec: 3.8 };
  const leftAnswer2 = { ...conversationPlan.messages[1]!, id: "custom_left_1", display_text: "第二个答案", raw_text: "第二个答案", start_sec: 4.0, end_sec: 4.5 };
  const fourMessagePlan = {
    ...conversationPlan,
    messages: [
      conversationPlan.messages[0]!,
      conversationPlan.messages[1]!,
      rightQuestion2,
      leftAnswer2,
    ],
  };
  const rightOnlyFrame = frameFixture(["msg_001"]);
  const answeredFrame = frameFixture(["msg_001", "msg_002"], { read_receipt: { message_id: "msg_001", state: "on" } });
  const rightLeftRightFrame = frameFixture(["msg_001", "msg_002", "custom_right_1"]);
  const rightRightLeftFrame = frameFixture(["msg_001", "custom_right_1", "custom_left_1"], { read_receipt: { message_id: "custom_right_1", state: "on" } });
  const allFrame = frameFixture(fourMessagePlan.messages.map((message) => message.id), { read_receipt: { message_id: "custom_right_1", state: "on" } });

  const rightOnlyHtml = renderChatFrameHtml({ frame: rightOnlyFrame, conversationPlan: fourMessagePlan });
  assert.equal(validateChatFrameHtml(rightOnlyHtml).ok, true);
  assert.equal(readReceiptCount(rightOnlyHtml), 0);

  const answeredHtml = renderChatFrameHtml({ frame: answeredFrame, conversationPlan: fourMessagePlan });
  assert.equal(readReceiptCount(answeredHtml), 1);

  const rightLeftRightHtml = renderChatFrameHtml({ frame: rightLeftRightFrame, conversationPlan: fourMessagePlan });
  assert.equal(readReceiptCount(rightLeftRightHtml), 0);

  const rightRightLeftHtml = renderChatFrameHtml({ frame: rightRightLeftFrame, conversationPlan: fourMessagePlan });
  assert.equal(readReceiptCount(rightRightLeftHtml), 1);
  assert.match(rightRightLeftHtml, /data-message-id="custom_right_1"/);
  assert.match(rightRightLeftHtml, /class="receipt-avatar avatar-slot"><img class="avatar-img" src="\.\.\/assets\/avatars\/1\.jpg"/);

  const html = renderChatFrameHtml({ frame: allFrame, conversationPlan: fourMessagePlan });
  assert.match(html, /class="time-marker inline"[^>]*>刚刚<\/div>/);
  assert.match(html, /data-message-id="custom_left_1"/);
  assert.match(html, /<span>已读<\/span>/);

  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "qivance-chat-frame-"));
  try {
    await writeChatFrameHtml({ htmlPath: path.join(projectRoot, allFrame.html_path), frame: allFrame, conversationPlan: fourMessagePlan });
    await access(path.join(projectRoot, "video/html-video/.html-video/projects/demo_project/assets/status_bar_icons/back_arrow.png"));
    await access(path.join(projectRoot, "video/html-video/.html-video/projects/demo_project/assets/status_bar_icons/avatar_online.png"));
    await access(path.join(projectRoot, "video/html-video/.html-video/projects/demo_project/assets/avatars/1.jpg"));
    await access(path.join(projectRoot, "video/html-video/.html-video/projects/demo_project/assets/avatars/2.jpg"));
    await access(path.join(projectRoot, "video/html-video/.html-video/projects/demo_project/assets/avatars/C.svg"));
    assert.equal((await lstat(path.join(projectRoot, "video/html-video/.html-video/projects/demo_project/assets/status_bar_icons/back_arrow.png"))).isSymbolicLink(), true);
    assert.equal((await lstat(path.join(projectRoot, "video/html-video/.html-video/projects/demo_project/assets/avatars/C.svg"))).isSymbolicLink(), true);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

function frameFixture(messageIds: string[], uiState: Partial<ChatFrameUiState> = {}) {
  return {
    frame_id: "custom_all_frame",
    html_path: "video/html-video/.html-video/projects/demo_project/frames/custom_all_frame.html",
    duration_sec: 1,
    section_ids: ["sec_001"],
    message_ids: messageIds,
    ui_state: { header: { phase: "default" }, ...uiState },
    text_policy: "verbatim_lyrics" as const,
    forbidden_remote_resources: true as const,
  };
}

test("rejects frame contracts that do not cover all messages", () => {
  const conversationPlan = conversationFixture();
  const animationPlan = buildChatAnimationPlan({ conversationPlan, durationSec: 4 });
  const frameContracts = buildChatFrameContracts({ projectId: "demo_project", conversationPlan, animationPlan });
  for (const frame of frameContracts.frames) {
    frame.message_ids = frame.message_ids.filter((messageId) => messageId !== "msg_002");
  }

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

function readReceiptCount(html: string): number {
  return html.match(/class="read-receipt\b/g)?.length ?? 0;
}

function totalDuration(frames: { duration_sec: number }[]): number {
  return Number(frames.reduce((sum, frame) => sum + frame.duration_sec, 0).toFixed(6));
}

function assertMonotonic(values: number[]): void {
  for (let index = 1; index < values.length; index += 1) {
    assert.ok(values[index]! >= values[index - 1]!);
  }
}

function statesForReceipt(frames: { ui_state: ChatFrameUiState }[], messageId: string): string[] {
  const states: string[] = [];
  for (const frame of frames) {
    const state = frame.ui_state.read_receipt?.message_id === messageId ? frame.ui_state.read_receipt.state : undefined;
    if (state && state !== states.at(-1)) states.push(state);
  }
  return states;
}

function withStartTimes<T extends { duration_sec: number }>(frames: T[]): { frame: T; startSec: number }[] {
  let startSec = 0;
  return frames.map((frame) => {
    const current = { frame, startSec: Number(startSec.toFixed(6)) };
    startSec += frame.duration_sec;
    return current;
  });
}
