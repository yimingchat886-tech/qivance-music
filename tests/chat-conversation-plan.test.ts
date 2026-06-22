import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CHAT_UI_PROFILE_PATH, buildConversationPlan, validateConversationPlan, withProjectChatAvatarUi } from "../src/lib/chat-dialogue/conversation-plan.ts";
import { buildLineTimings } from "../src/lib/chat-dialogue/line-timing.ts";
import { buildLyricsLineMap } from "../src/lib/chat-dialogue/lyrics-line-map.ts";
import { buildSpeakerAttribution } from "../src/lib/chat-dialogue/speaker-attribution.ts";

test("builds production conversation plan from explicit line timing", () => {
  const lineMap = buildLyricsLineMap({ lyricsText: "问：hello world?\n答：answer now\n", lyricsSha256: "lyrics-sha" });
  const speakerAttribution = buildSpeakerAttribution({ lineMap });
  const sectionMap = sectionMapFixture();
  const lyricWordTiming = {
    words: [
      { line_id: "line_001", word: "hello", start_sec: 0.5, end_sec: 0.8 },
      { line_id: "line_001", word: "world", start_sec: 0.9, end_sec: 1.2 },
      { line_id: "line_002", word: "answer", start_sec: 1.5, end_sec: 1.8 },
      { line_id: "line_002", word: "now", start_sec: 1.9, end_sec: 2.2 },
    ],
  };

  const result = buildConversationPlan({
    lineMap,
    speakerAttribution,
    lyricWordTiming,
    sectionMap,
    lyricsSha256: "lyrics-sha",
    audioSha256: "audio-sha",
  });

  assert.deepEqual(result.issues, []);
  assert.ok(result.conversationPlan);
  assert.equal(result.conversationPlan.messages[0]?.raw_text, "问：hello world?");
  assert.equal(result.conversationPlan.messages[0]?.display_text, "hello world?");
  assert.equal(result.conversationPlan.messages[0]?.speaker, "questioner");
  assert.equal(result.conversationPlan.messages[1]?.section_id, "sec_001");
  assert.equal(validateConversationPlan({ conversationPlan: result.conversationPlan, lineMap, speakerAttribution }).ok, true);
});

test("blocks production plan without timing evidence", () => {
  const lineMap = buildLyricsLineMap({ lyricsText: "问：hello world?\n答：answer now\n" });
  const result = buildConversationPlan({
    lineMap,
    speakerAttribution: buildSpeakerAttribution({ lineMap }),
    sectionMap: sectionMapFixture(),
    lyricWordTiming: null,
  });

  assert.match(result.issues.join("\n"), /lyric_word_timing is required/);
});

test("injects packaged default avatar profile without requiring project jpgs", async () => {
  const avatarPlan = await withProjectChatAvatarUi({
    projectRoot: "/tmp/project-without-avatars",
    conversationPlan: conversationPlanFixture(),
  });

  assert.equal(avatarPlan.chat_ui?.contact_avatar_src, "../assets/avatars/1.jpg");
  assert.equal(avatarPlan.chat_ui?.left_avatar_src, "../assets/avatars/1.jpg");
  assert.equal(avatarPlan.chat_ui?.right_avatar_src, "../assets/avatars/2.jpg");
});

test("merges project chat ui profile into the single header contact profile", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "qivance-chat-ui-"));
  await writeProfile(projectRoot, {
    contact_name: "林同学",
    contact_status: "今天在线",
    contact_avatar_src: "../assets/avatars/contact.jpg",
    left_avatar_src: "../assets/avatars/contact.jpg",
    right_avatar_src: "../assets/avatars/self.jpg",
  });

  const avatarPlan = await withProjectChatAvatarUi({
    projectRoot,
    conversationPlan: conversationPlanFixture(),
  });

  assert.equal(avatarPlan.chat_ui?.contact_name, "林同学");
  assert.equal(avatarPlan.chat_ui?.contact_status, "今天在线");
  assert.equal(avatarPlan.chat_ui?.contact_avatar_src, "../assets/avatars/contact.jpg");
  assert.equal(avatarPlan.chat_ui?.left_avatar_src, "../assets/avatars/contact.jpg");
  assert.equal(avatarPlan.chat_ui?.right_avatar_src, "../assets/avatars/self.jpg");
});

test("rejects remote project chat avatar profile paths", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "qivance-chat-ui-"));
  await writeProfile(projectRoot, {
    contact_avatar_src: "https://example.com/avatar.jpg",
  });

  await assert.rejects(
    withProjectChatAvatarUi({
      projectRoot,
      conversationPlan: conversationPlanFixture(),
    }),
    /contact_avatar_src must be local/,
  );
});

test("uses diagnostic fallback only when allowed", () => {
  const lineMap = buildLyricsLineMap({ lyricsText: "问：hello world?\n答：answer now\n" });
  const timings = buildLineTimings({
    lineMap,
    sectionMap: sectionMapFixture(),
    lyricWordTiming: null,
    allowDiagnosticFallback: true,
  });

  assert.equal(timings.diagnosticFallbackUsed, true);
  assert.equal(timings.timings.length, 2);
  assert.equal(timings.timings[0]?.timing_source, "diagnostic_even_split");
});

test("matches WhisperX text-only word timing in production fallback path", () => {
  const lineMap = buildLyricsLineMap({ lyricsText: "Q: hello world\nA: answer now\n" });
  const timings = buildLineTimings({
    lineMap,
    sectionMap: sectionMapFixture(),
    lyricWordTiming: {
      words: [
        { text: "hello", start_sec: 0.1, end_sec: 0.4 },
        { text: "world", start_sec: 0.5, end_sec: 0.9 },
        { text: "answer", start_sec: 1.0, end_sec: 1.4 },
        { text: "now", start_sec: 1.5, end_sec: 1.9 },
      ],
    },
  });

  assert.deepEqual(timings.issues, []);
  assert.equal(timings.diagnosticFallbackUsed, false);
  assert.equal(timings.timings.length, 2);
});

test("matches Chinese and mixed Latin WhisperX chunks without whitespace in production timing", () => {
  const lineMap = buildLyricsLineMap({ lyricsText: "[Intro]\n手机咋比我还会跑腿？\nAI agent把桌上事办到眼前\n写SQL拉数据画出清晨\nRAG翻知识库API打开新门\n" });
  const timings = buildLineTimings({
    lineMap,
    sectionMap: sectionMapFixture(),
    lyricWordTiming: {
      words: [
        { text: "[Intro]", start_sec: 0.1, end_sec: 0.5 },
        { text: "手机", start_sec: 1.0, end_sec: 1.2 },
        { text: "咋比", start_sec: 1.2, end_sec: 1.4 },
        { text: "我还", start_sec: 1.4, end_sec: 1.6 },
        { text: "会跑", start_sec: 1.6, end_sec: 1.8 },
        { text: "腿？", start_sec: 1.8, end_sec: 2.0 },
        { text: "AIagent", start_sec: 2.1, end_sec: 2.3 },
        { text: "把桌", start_sec: 2.3, end_sec: 2.5 },
        { text: "上事办", start_sec: 2.5, end_sec: 2.7 },
        { text: "到眼前", start_sec: 2.7, end_sec: 2.9 },
        { text: "写SQL拉", start_sec: 3.0, end_sec: 3.2 },
        { text: "数据画出清晨", start_sec: 3.2, end_sec: 3.6 },
        { text: "RAG翻知识库API打开新门", start_sec: 3.7, end_sec: 4.0 },
      ],
    },
  });

  assert.deepEqual(timings.issues, []);
  assert.equal(timings.diagnosticFallbackUsed, false);
  assert.equal(timings.timings.length, 4);
  assert.equal(timings.timings[0]?.start_sec, 1.0);
  assert.equal(timings.timings[3]?.end_sec, 4.0);
});

function sectionMapFixture() {
  return {
    duration_sec: 4,
    sections: [
      { section_id: "sec_001", start_sec: 0, end_sec: 4 },
    ],
  };
}

function conversationPlanFixture() {
  const lineMap = buildLyricsLineMap({ lyricsText: "问：hello world?\n答：answer now\n", lyricsSha256: "lyrics-sha" });
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
    sectionMap: sectionMapFixture(),
    lyricsSha256: "lyrics-sha",
    audioSha256: "audio-sha",
  });
  assert.ok(result.conversationPlan);
  return result.conversationPlan;
}

async function writeProfile(projectRoot: string, profile: Record<string, unknown>): Promise<void> {
  const filePath = path.join(projectRoot, CHAT_UI_PROFILE_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
}
