import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { importAcceptedMusicProject } from "../src/lib/import-project.ts";
import { importStoryboardFromJson } from "../src/lib/storyboard-import.ts";
import { loadProjectSummary, renderHyperframesPage, renderImportPage, renderProjectWorkspace, renderProjectsPage } from "../src/lib/web-ui.ts";

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

test("projects UI exposes a delete action for each imported project", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "qivance-web-delete-"));
  const sourceAudio = path.join(tempRoot, "raw.mp3");
  await writeFile(sourceAudio, Buffer.from("fake-audio-for-delete-ui"));
  const imported = await importAcceptedMusicProject({
    storageRoot: path.join(tempRoot, "projects"),
    topic: "可以删除的项目",
    targetDuration: 60,
    lyricsMarkdown: "[Verse]\n删除测试",
    rawAudioPath: sourceAudio,
  });

  const summary = await loadProjectSummary(imported.projectPath);
  const html = renderProjectsPage([summary]);

  assert.match(html, new RegExp(`/projects/${imported.projectId}/delete`));
  assert.match(html, /删除/);
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
  assert.match(html, /开始制作 HyperFrames 视频/);
  assert.doesNotMatch(html, /OK，分镜通过并渲染 Preview/);
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

test("workspace UI shows gate progress, storyboard paste, HyperFrames subpage link, and grouped artifacts", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "qivance-web-hyperframes-"));
  const sourceAudio = path.join(tempRoot, "raw.mp3");
  await writeFile(sourceAudio, Buffer.from("fake-audio-for-ui"));
  const imported = await importAcceptedMusicProject({
    storageRoot: path.join(tempRoot, "projects"),
    topic: "太阳风从哪里来",
    targetDuration: 60,
    lyricsMarkdown: "[Verse]\n太阳喷出带电粒子",
    rawAudioPath: sourceAudio,
  });
  await writeJson(path.join(imported.projectPath, "qa", "music", "music_ingest_qa_report.json"), {
    status: "rule_pass",
  });
  await writeJson(path.join(imported.projectPath, "qa", "timing", "timing_qa_report.json"), {
    status: "rule_fail_blocked",
    blocking_issues: ["Section map overlaps."],
  });
  await writeJson(path.join(imported.projectPath, "logs", "hyperframes_ui.json"), {
    project_id: imported.projectId,
    status: "running",
    pid: process.pid,
    port: 3999,
    host: "0.0.0.0",
    url: "http://192.168.1.25:3999/#project/hypeframes",
    started_at: "2026-05-29T00:00:00.000Z",
  });

  const summary = await loadProjectSummary(imported.projectPath);
  const html = renderProjectWorkspace(summary);

  assert.match(html, /Gate Progress/);
  assert.match(html, /Music Ingest/);
  assert.match(html, /Section map overlaps\./);
  assert.match(html, /Artifacts: 3 \/ 6/);
  assert.match(html, /QA: <code>qa\/music\/music_ingest_qa_report\.json<\/code>/);
  assert.match(html, /name="storyboardJson"/);
  assert.match(html, /storyboard\/import/);
  assert.match(html, /hyperframes-ui\/start/);
  assert.match(html, new RegExp('/projects/' + imported.projectId + '/hyperframes'));
  assert.match(html, /打开 HyperFrames 子页面/);
  assert.doesNotMatch(html, /<iframe\b/);
  assert.match(html, /Music Lock \/ Audio Ingest/);
  assert.match(html, /Timing Schema Gate/);
  assert.match(html, /Render \/ Preview QA/);
  assert.match(html, /Section map/);
  assert.match(html, /Timing QA/);
  assert.match(html, /data\/timing\/section_map\.json/);
  assert.match(html, /qa\/timing\/timing_qa_report\.json/);
  assert.match(html, /missing/);
  assert.doesNotMatch(html, /<video controls/);
});

test("standalone HyperFrames page renders runtime controls, iframe, artifacts, and errors", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "qivance-web-hyperframes-page-"));
  const sourceAudio = path.join(tempRoot, "raw.mp3");
  await writeFile(sourceAudio, Buffer.from("fake-audio-for-ui"));
  const imported = await importAcceptedMusicProject({
    storageRoot: path.join(tempRoot, "projects"),
    topic: "磁场为什么能保护地球",
    targetDuration: 60,
    lyricsMarkdown: "[Verse]\n磁场挡住高能粒子",
    rawAudioPath: sourceAudio,
  });
  await writeJson(path.join(imported.projectPath, "logs", "hyperframes_ui.json"), {
    project_id: imported.projectId,
    status: "running",
    pid: process.pid,
    port: 3999,
    host: "0.0.0.0",
    url: "http://192.168.1.25:3999/#project/hypeframes",
    started_at: "2026-05-29T00:00:00.000Z",
  });
  await writeFileAt(imported.projectPath, "hypeframes/src/index.html", "<!doctype html>");
  await writeJson(path.join(imported.projectPath, "qa", "hypeframes", "hypeframes_file_qa_report.json"), {
    status: "rule_pass",
  });
  await writeJson(path.join(imported.projectPath, "qa", "hypeframes", "hyperframes_skills_status.json"), {
    name: "qivance-hyperframes-skills",
    version: "1.0.0",
    hash: "b".repeat(64),
    source: "qivance-app:resources/hyperframes-skills/v1",
    cache_status: "created",
    prepared_at: "2026-06-02T00:00:00.000Z",
    success: true,
    failure_reason: null,
    skill_paths: ["hypeframes/.agents/skills/hyperframes-composition/SKILL.md"],
  });
  await writeJson(path.join(imported.projectPath, "qa", "hypeframes", "hyperframes_skills_qa_report.json"), {
    status: "rule_pass",
  });
  await writeJson(path.join(imported.projectPath, "qa", "hypeframes", "codex_forbidden_path_qa_report.json"), {
    status: "rule_fail_blocked",
    blocking_issues: ["Codex attempted to modify HyperFrames skill files."],
  });

  const summary = await loadProjectSummary(imported.projectPath);
  const html = renderHyperframesPage(summary, { error: "Missing HypeFrames project file." });

  assert.ok(html.includes("Missing HypeFrames project file."));
  assert.ok(html.includes(`href="/projects/${imported.projectId}"`));
  assert.ok(html.includes("hyperframes-ui/start"));
  assert.ok(html.includes("Status: <code>running</code>"));
  assert.ok(html.includes('<iframe src="http://192.168.1.25:3999/#project/hypeframes"'));
  assert.ok(html.includes("HypeFrames Project"));
  assert.ok(html.includes("WSL Codex CLI"));
  assert.ok(html.includes("HyperFrames Skills"));
  assert.ok(html.includes("Name: <code>qivance-hyperframes-skills</code>"));
  assert.ok(html.includes("Version: <code>1.0.0</code>"));
  assert.ok(html.includes("Hash: <code>" + "b".repeat(64) + "</code>"));
  assert.ok(html.includes("Source: <code>qivance-app:resources/hyperframes-skills/v1</code>"));
  assert.ok(html.includes("Cache: <code>created</code>"));
  assert.ok(html.includes("Manifest / QA"));
  assert.ok(html.includes("qa/hypeframes/hyperframes_skills_status.json"));
  assert.ok(html.includes("qa/hypeframes/hyperframes_skills_qa_report.json"));
  assert.ok(html.includes("Debug Details"));
  assert.ok(html.includes("hypeframes/.agents/skills/hyperframes-composition/SKILL.md"));
  assert.doesNotMatch(html, /HyperFrames composition skill/);
  assert.ok(html.includes("Codex Run Logs"));
  assert.ok(html.includes("Gate Status"));
  assert.ok(html.includes("Codex forbidden path gate: <code>fail</code>"));
  assert.ok(html.includes("Codex attempted to modify HyperFrames skill files."));
  assert.ok(html.includes("hypeframes/src/index.html"));
  assert.ok(html.includes("HypeFrames File QA"));

  const stoppedHtml = renderHyperframesPage({
    ...summary,
    hyperframesUi: { ...summary.hyperframesUi, status: "stopped" },
  });
  assert.doesNotMatch(stoppedHtml, /<iframe\b/);
  assert.match(stoppedHtml, /HyperFrames UI is not running/);
});


test("standalone HyperFrames page uses the skills QA gate as dependency status authority", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "qivance-web-hyperframes-skills-gate-"));
  const sourceAudio = path.join(tempRoot, "raw.mp3");
  await writeFile(sourceAudio, Buffer.from("fake-audio-for-skills-gate-ui"));
  const imported = await importAcceptedMusicProject({
    storageRoot: path.join(tempRoot, "projects"),
    topic: "skills gate 权威状态测试",
    targetDuration: 60,
    lyricsMarkdown: "[Verse]\nskills gate 是权威",
    rawAudioPath: sourceAudio,
  });
  await writeJson(path.join(imported.projectPath, "qa", "hypeframes", "hyperframes_skills_qa_report.json"), {
    status: "rule_pass",
  });

  const html = renderHyperframesPage(await loadProjectSummary(imported.projectPath));

  assert.match(html, /<h2>HyperFrames Skills<\/h2>[\s\S]*Status: <code>passed<\/code>/);
  assert.match(
    html,
    /qa\/hypeframes\/hyperframes_skills_status\.json<\/code> <span class="muted">not yet produced<\/span>/,
  );
});

test("standalone HyperFrames page keeps unfinished runtime artifacts pending until a gate finishes", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "qivance-web-hyperframes-pending-"));
  const sourceAudio = path.join(tempRoot, "raw.mp3");
  await writeFile(sourceAudio, Buffer.from("fake-audio-for-pending-ui"));
  const imported = await importAcceptedMusicProject({
    storageRoot: path.join(tempRoot, "projects"),
    topic: "运行中状态语义测试",
    targetDuration: 60,
    lyricsMarkdown: "[Verse]\n运行中不能误报缺失",
    rawAudioPath: sourceAudio,
  });

  let html = renderHyperframesPage(await loadProjectSummary(imported.projectPath));

  assert.match(html, /not yet produced/);
  assert.match(
    html,
    /qa\/hypeframes\/hyperframes_skills_status\.json<\/code> <span class="muted">not yet produced<\/span>/,
  );
  assert.doesNotMatch(html, /<span class="muted">missing<\/span>/);

  await writeJson(path.join(imported.projectPath, "qa", "hypeframes", "hypeframes_file_qa_report.json"), {
    status: "rule_pass",
  });
  html = renderHyperframesPage(await loadProjectSummary(imported.projectPath));

  assert.match(html, /<span class="muted">missing<\/span>/);
});


async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value), "utf8");
}

async function writeFileAt(projectPath: string, relativePath: string, value: string): Promise<void> {
  const filePath = path.join(projectPath, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

test("workspace UI explains states without manual actions instead of exposing MVP copy", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "qivance-web-no-action-"));
  const sourceAudio = path.join(tempRoot, "raw.mp3");
  await writeFile(sourceAudio, Buffer.from("fake-audio-for-no-action-ui"));
  const imported = await importAcceptedMusicProject({
    storageRoot: path.join(tempRoot, "projects"),
    topic: "状态提示测试",
    targetDuration: 60,
    lyricsMarkdown: "[Verse]\n状态要清楚",
    rawAudioPath: sourceAudio,
  });
  await writeJson(path.join(imported.projectPath, "project_manifest.json"), {
    project_id: imported.projectId,
    topic: "状态提示测试",
    target_duration: 60,
    aspect_ratio: "9:16",
    current_workflow_state: "preview_rendering",
    actual_audio_duration: null,
    locked_audio_hash: null,
    preview_video_hash: null,
  });

  const html = renderProjectWorkspace(await loadProjectSummary(imported.projectPath));

  assert.doesNotMatch(html, /Current status does not expose a manual action in this first MVP/);
  assert.match(html, /当前状态下没有可执行的手动操作，请等待系统完成当前任务。/);
});

test("workspace UI marks imported storyboard as complete and shows the next step", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "qivance-web-storyboard-imported-"));
  const sourceAudio = path.join(tempRoot, "raw.mp3");
  await writeFile(sourceAudio, Buffer.from("fake-audio-for-storyboard-imported-ui"));
  const imported = await importAcceptedMusicProject({
    storageRoot: path.join(tempRoot, "projects"),
    topic: "分镜导入状态测试",
    targetDuration: 60,
    lyricsMarkdown: "[Verse]\n分镜完成后要可见",
    rawAudioPath: sourceAudio,
  });

  await importStoryboardFromJson({
    projectPath: imported.projectPath,
    storyboardJson: JSON.stringify({
      scenes: [
        { scene_id: "scene_001", section_id: "sec_001", start_sec: 0, end_sec: 3 },
      ],
      captions: [
        { scene_id: "scene_001", start_sec: 0, end_sec: 2, text: "分镜已导入" },
      ],
      visuals: [
        { scene_id: "scene_001", type: "concept_card" },
      ],
    }),
  });

  const html = renderProjectWorkspace(await loadProjectSummary(imported.projectPath));

  assert.match(html, /分镜脚本已导入/);
  assert.match(html, /场景 1/);
  assert.match(html, /字幕 1/);
  assert.match(html, /视觉 1/);
  assert.match(html, /开始制作 HyperFrames 视频/);
  assert.doesNotMatch(html, /name="storyboardJson"/);
  assert.doesNotMatch(html, /<textarea/);
});
