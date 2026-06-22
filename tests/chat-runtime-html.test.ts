import assert from "node:assert/strict";
import { access, lstat, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildChatAnimationPlan } from "../src/lib/chat-dialogue/chat-animation-plan.ts";
import { renderChatRuntimeHtml, validateChatRuntimeHtml, writeChatRuntimeHtml } from "../src/lib/chat-dialogue/chat-runtime-html.ts";
import { buildChatRuntimeTimeline } from "../src/lib/chat-dialogue/chat-runtime-timeline.ts";
import type { ConversationPlan } from "../src/lib/chat-dialogue/conversation-plan.ts";

test("renders local-only runtime chat HTML with timeline controller", () => {
  const conversationPlan = conversationFixture();
  const animationPlan = buildChatAnimationPlan({ conversationPlan, durationSec: 4 });
  const runtimeTimeline = buildChatRuntimeTimeline({ conversationPlan, animationPlan });
  const html = renderChatRuntimeHtml({ conversationPlan, animationPlan, runtimeTimeline });
  const validation = validateChatRuntimeHtml(html);

  assert.equal(validation.ok, true, validation.issues.join("\n"));
  assert.match(html, /id="qivance-chat-runtime-data"/);
  assert.match(html, /data-douyin-chat-shell/);
  assert.match(html, /class="row right is-hidden" data-message-id="msg_001"/);
  assert.match(html, /class="row left is-hidden" data-message-id="msg_002"/);
  assert.match(html, /class="peer-name">蒲涛<\/span>/);
  assert.match(html, /class="typing-name">对方正在输入\.\.\.\.<\/span>/);
  assert.match(html, /@keyframes bubbleFloatPop/);
  assert.match(html, /@keyframes avatarSoftIn/);
  assert.match(html, /@keyframes receiptIn/);
  assert.match(html, /@keyframes receiptOut/);
  assert.match(html, /window\.__qivanceChatRuntime/);
  assert.match(html, /function playTimeline/);
  assert.match(html, /function seekTimeline/);
  assert.match(html, /function enterMessage/);
  assert.match(html, /animationend/);
  assert.match(html, /classList/);
  assert.match(html, /overflow-wrap:\s*anywhere/);
  assert.match(html, /class="receipt-avatar avatar-slot"><img class="avatar-img" src="\.\.\/assets\/avatars\/1\.jpg"/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /@import/);
  assert.doesNotMatch(html, /read-out[\s\S]{0,200}display\s*:\s*none/i);
});

test("writes runtime HTML under the project runtime directory", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "qivance-runtime-html-"));
  const html = "<!doctype html><html></html>";
  const result = await writeChatRuntimeHtml({ projectRoot: tmp, projectId: "project_001", html });

  assert.equal(result.path, "video/html-video/.html-video/projects/project_001/runtime/chat_dialogue_mv.html");
  assert.equal(await readFile(path.join(tmp, result.path), "utf8"), html);
  await access(path.join(tmp, "video/html-video/.html-video/projects/project_001/assets/status_bar_icons/back_arrow.png"));
  await access(path.join(tmp, "video/html-video/.html-video/projects/project_001/assets/status_bar_icons/video_camera.png"));
  await access(path.join(tmp, "video/html-video/.html-video/projects/project_001/assets/avatars/1.jpg"));
  await access(path.join(tmp, "video/html-video/.html-video/projects/project_001/assets/avatars/2.jpg"));
  await access(path.join(tmp, "video/html-video/.html-video/projects/project_001/assets/avatars/A.jpg"));
  await access(path.join(tmp, "video/html-video/.html-video/projects/project_001/assets/avatars/B.jpg"));
  await access(path.join(tmp, "video/html-video/.html-video/projects/project_001/assets/avatars/C.svg"));
  assert.equal((await lstat(path.join(tmp, "video/html-video/.html-video/projects/project_001/assets/status_bar_icons/back_arrow.png"))).isSymbolicLink(), true);
  assert.equal((await lstat(path.join(tmp, "video/html-video/.html-video/projects/project_001/assets/avatars/A.jpg"))).isSymbolicLink(), true);
});

function conversationFixture(): ConversationPlan {
  return {
    schema_version: 1,
    chain_id: "chat_dialogue_mv",
    text_policy: "verbatim_lyrics",
    source: {
      lyrics_path: "lyrics.md",
      audio_path: "active_music_take.mp3",
      lyrics_sha256: "lyrics",
      audio_sha256: "audio",
    },
    timing: {
      source: "lyric_word_timing",
      lyric_word_timing_path: "data/timing/lyric_word_timing.json",
      section_map_path: "data/timing/section_map.json",
      diagnostic_fallback_used: false,
    },
    speakers: [],
    chat_ui: {
      contact_avatar_src: "../assets/avatars/1.jpg",
      left_avatar_src: "../assets/avatars/1.jpg",
      right_avatar_src: "../assets/avatars/2.jpg",
    },
    messages: [
      message("msg_001", "right", "questioner", 0.5, 1.2, "hello world?"),
      message("msg_002", "left", "answerer", 1.5, 2.2, "answer now"),
    ],
  };
}

function message(
  id: string,
  side: "left" | "right",
  speaker: "questioner" | "answerer",
  start_sec: number,
  end_sec: number,
  display_text: string,
): ConversationPlan["messages"][number] {
  return {
    id,
    source_line_id: id.replace("msg", "line"),
    speaker,
    side,
    raw_text: display_text,
    display_text,
    text_policy: "verbatim_lyrics",
    attribution_source: speaker === "questioner" ? "explicit_question_prefix" : "explicit_answer_prefix",
    start_sec,
    end_sec,
    section_id: "sec_001",
    confidence: 0.95,
  };
}
