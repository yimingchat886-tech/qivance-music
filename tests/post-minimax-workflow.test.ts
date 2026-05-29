import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { importAcceptedMusicProject } from "../src/lib/import-project.ts";
import {
  approvePreview,
  approveScenePlan,
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
    "aevalsrc='if(lt(mod(t,0.5),0.035),0.95*sin(2*PI*1000*t),0.05*sin(2*PI*220*t))':s=44100:d=4",
    "-c:a",
    "libmp3lame",
    sourceAudio,
  ]);

  const project = await importAcceptedMusicProject({
    storageRoot: path.join(tempRoot, "projects"),
    topic: "恒星为什么会发光",
    targetDuration: 60,
    mainComposition: "science-horizontal",
    videoSize: "1920x1080",
    lyricsMarkdown: "[Intro]\n恒星点亮夜空\n\n[Verse]\n核心里面在聚变\n氢原子合成氦\n\n[Hook]\n光和热一起冲出来",
    rawAudioPath: sourceAudio,
  });

  await lockAcceptedMusic(project.projectPath);
  await generateBeatLock(project.projectPath);
  await generateSectionMap(project.projectPath);
  await generateScenePlans(project.projectPath);
  await approveScenePlan(project.projectPath, "test-reviewer");
  await generateHypeframesProject(project.projectPath);
  await renderPreview(project.projectPath);
  await approvePreview(project.projectPath, "test-reviewer");

  await stat(path.join(project.projectPath, "audio", "master", "minimax_rap_master.wav"));
  await stat(path.join(project.projectPath, "audio", "analysis", "minimax_rap_analysis.wav"));
  await stat(path.join(project.projectPath, "data", "timing", "beats.locked.json"));
  await stat(path.join(project.projectPath, "data", "timing", "section_map.json"));
  await stat(path.join(project.projectPath, "data", "storyboard", "scene_plan.json"));
  await stat(path.join(project.projectPath, "qa", "storyboard", "scene_human_approval.md"));
  await stat(path.join(project.projectPath, "hypeframes", "src", "index.html"));
  await stat(path.join(project.projectPath, "hypeframes", "render_targets", "render_targets.json"));
  await stat(path.join(project.projectPath, "dist", "preview", "preview_composite.mp4"));
  await stat(path.join(project.projectPath, "dist", "review", "preview_composite_review.mp4"));
  await stat(path.join(project.projectPath, "dist", "final", "hypeframes_final.mp4"));
  await stat(path.join(project.projectPath, "qa", "render", "keyframes_contact_sheet.jpg"));

  const musicManifest = JSON.parse(
    await readFile(path.join(project.projectPath, "audio", "music_manifest.json"), "utf8"),
  );
  const beatsLocked = JSON.parse(
    await readFile(path.join(project.projectPath, "data", "timing", "beats.locked.json"), "utf8"),
  );
  const renderQa = JSON.parse(
    await readFile(path.join(project.projectPath, "qa", "render", "render_qa_report.json"), "utf8"),
  );
  const hypeframesConfig = JSON.parse(
    await readFile(path.join(project.projectPath, "hypeframes", "src", "config.json"), "utf8"),
  );
  const hypeframesHtml = await readFile(path.join(project.projectPath, "hypeframes", "src", "index.html"), "utf8");
  const renderPlan = JSON.parse(
    await readFile(path.join(project.projectPath, "data", "storyboard", "render_plan.json"), "utf8"),
  );
  const renderManifest = JSON.parse(
    await readFile(path.join(project.projectPath, "dist", "render_manifest.json"), "utf8"),
  );
  const masterQa = JSON.parse(
    await readFile(path.join(project.projectPath, "qa", "master_qa_report.json"), "utf8"),
  );
  const workflowSnapshot = JSON.parse(
    await readFile(path.join(project.projectPath, "workflow_snapshot.json"), "utf8"),
  );

  assert.equal(beatsLocked.audio_hash, musicManifest.sha256);
  assert.ok(Math.abs(beatsLocked.bpm - 120) <= 4);
  assert.equal(beatsLocked.lock_method, "audio_analysis");
  assert.equal(hypeframesConfig.main_composition, "science-horizontal");
  assert.equal(hypeframesConfig.width, 1920);
  assert.equal(hypeframesConfig.height, 1080);
  assert.match(hypeframesHtml, /id="science-horizontal"/);
  assert.deepEqual(renderPlan.resolution, [1920, 1080]);
  assert.deepEqual(renderManifest.resolution, [1920, 1080]);
  assert.equal(renderQa.status, "rule_pass");
  assert.equal(masterQa.status, "rule_pass");
  assert.equal(workflowSnapshot.workflow_state, "hypeframes_video_ready");
});
