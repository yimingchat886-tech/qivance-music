import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { importAcceptedMusicProject } from "../src/lib/import-project.ts";
import {
  generateBeatLock,
  generateHypeframesProject,
  generateScenePlans,
  generateSectionMap,
  lockAcceptedMusic,
  renderPreview,
} from "../src/lib/post-minimax-workflow.ts";

const execFileAsync = promisify(execFile);

test("runs the post-MiniMax workflow from accepted audio to preview assets", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "qivance-workflow-"));
  const sourceAudio = path.join(tempRoot, "tone.mp3");
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1.6",
    "-c:a",
    "libmp3lame",
    sourceAudio,
  ]);

  const project = await importAcceptedMusicProject({
    storageRoot: path.join(tempRoot, "projects"),
    inputConfig: {
      topic: "恒星为什么会发光",
      target_duration: 60,
      audience: "泛科普用户",
      tone: "热血",
      rap_style: "boom bap",
      aspect_ratio: "9:16",
      platform: "douyin",
      budget_limit: 0,
      auto_continue: false,
      auto_approve_music: true,
      auto_approve_preview: false,
    },
    lyricsMarkdown: "[Intro]\n恒星点亮夜空\n\n[Verse]\n核心里面在聚变\n氢原子合成氦\n\n[Hook]\n光和热一起冲出来",
    rawAudioPath: sourceAudio,
  });

  await lockAcceptedMusic(project.projectPath);
  await generateBeatLock(project.projectPath);
  await generateSectionMap(project.projectPath);
  await generateScenePlans(project.projectPath);
  await generateHypeframesProject(project.projectPath);
  await renderPreview(project.projectPath);

  await stat(path.join(project.projectPath, "audio", "minimax_rap_master.wav"));
  await stat(path.join(project.projectPath, "data", "beats.locked.json"));
  await stat(path.join(project.projectPath, "data", "section_map.json"));
  await stat(path.join(project.projectPath, "data", "scene_plan.json"));
  await stat(path.join(project.projectPath, "hypeframes", "index.html"));
  await stat(path.join(project.projectPath, "dist", "preview_composite.mp4"));
  await stat(path.join(project.projectPath, "dist", "preview_composite_review.mp4"));
  await stat(path.join(project.projectPath, "dist", "keyframes_contact_sheet.jpg"));

  const musicManifest = JSON.parse(
    await readFile(path.join(project.projectPath, "audio", "music_manifest.json"), "utf8"),
  );
  const beatsLocked = JSON.parse(
    await readFile(path.join(project.projectPath, "data", "beats.locked.json"), "utf8"),
  );
  const renderQa = JSON.parse(
    await readFile(path.join(project.projectPath, "qa", "render_qa_report.json"), "utf8"),
  );
  const masterQa = JSON.parse(
    await readFile(path.join(project.projectPath, "qa", "master_qa_report.json"), "utf8"),
  );

  assert.equal(beatsLocked.locked_audio_hash, musicManifest.hash);
  assert.equal(renderQa.status, "auto_approved");
  assert.equal(masterQa.status, "auto_approved");
});

