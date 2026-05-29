import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { importAcceptedMusicProject } from "../src/lib/import-project.ts";
import { loadProjectSummary, renderImportPage, renderProjectWorkspace } from "../src/lib/web-ui.ts";

test("import UI uploads audio and exposes HypeFrames render settings without raw JSON config", () => {
  const html = renderImportPage();

  assert.match(html, /enctype="multipart\/form-data"/);
  assert.match(html, /type="file" name="rawAudioFile"/);
  assert.match(html, /name="topic"/);
  assert.match(html, /name="mainComposition"/);
  assert.match(html, /name="videoSize"/);
  assert.match(html, /1080x1920/);
  assert.match(html, /1920x1080/);
  assert.doesNotMatch(html, /Input config JSON/);
  assert.doesNotMatch(html, /name="inputConfig"/);
  assert.doesNotMatch(html, /music_accepted/);
});

test("workspace UI exposes only post-MiniMax preview actions for the first MVP", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "qivance-web-"));
  const sourceAudio = path.join(tempRoot, "raw.mp3");
  await writeFile(sourceAudio, Buffer.from("fake-audio-for-ui"));
  const imported = await importAcceptedMusicProject({
    storageRoot: path.join(tempRoot, "projects"),
    topic: "光合作用为什么重要",
    targetDuration: 60,
    lyricsMarkdown: "[Verse]\n叶绿体接住阳光",
    rawAudioPath: sourceAudio,
  });

  const summary = await loadProjectSummary(imported.projectPath);
  const html = renderProjectWorkspace(summary);

  assert.match(html, /运行到分镜审批/);
  assert.match(html, /music_locking/);
  assert.doesNotMatch(html, /MiniMax Music 生成/);
  assert.doesNotMatch(html, /生成歌词/);
  assert.doesNotMatch(html, /积分扣费/);
});

test("workspace UI exposes button-style OK approvals", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "qivance-web-"));
  const sourceAudio = path.join(tempRoot, "raw.mp3");
  await writeFile(sourceAudio, Buffer.from("fake-audio-for-ui"));
  const imported = await importAcceptedMusicProject({
    storageRoot: path.join(tempRoot, "projects"),
    topic: "为什么月亮会变圆缺",
    targetDuration: 60,
    lyricsMarkdown: "[Verse]\n月相变化不是月亮变形",
    rawAudioPath: sourceAudio,
  });

  await writeFile(
    path.join(imported.projectPath, "project_manifest.json"),
    JSON.stringify({
      project_id: imported.projectId,
      topic: "为什么月亮会变圆缺",
      target_duration: 60,
      aspect_ratio: "9:16",
      current_workflow_state: "scene_waiting_human",
      actual_audio_duration: null,
      locked_audio_hash: null,
      preview_video_hash: null,
    }),
    "utf8",
  );
  let summary = await loadProjectSummary(imported.projectPath);
  let html = renderProjectWorkspace(summary);
  assert.match(html, /OK，分镜通过并渲染 Preview/);
  assert.match(html, /approve-scene/);

  await writeFile(
    path.join(imported.projectPath, "project_manifest.json"),
    JSON.stringify({
      project_id: imported.projectId,
      topic: "为什么月亮会变圆缺",
      target_duration: 60,
      aspect_ratio: "9:16",
      current_workflow_state: "preview_waiting_human",
      actual_audio_duration: null,
      locked_audio_hash: null,
      preview_video_hash: null,
    }),
    "utf8",
  );
  summary = await loadProjectSummary(imported.projectPath);
  html = renderProjectWorkspace(summary);
  assert.match(html, /OK，Preview 通过并登记成品/);
  assert.match(html, /approve-preview/);
});
