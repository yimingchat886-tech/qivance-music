import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { resolveSmallProjectPaths } from "../src/lib/project-core/paths.ts";
import { runHtmlVideoWorkflow } from "../src/lib/video-html/html-video-workflow.ts";

const fixtureDir = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (!fixtureDir) {
  console.error("Usage: pnpm demo:html-video");
  process.exit(1);
}

const storageRoot = path.resolve("projects");
const smallProjectId = "demo_html_video_001";
const paths = resolveSmallProjectPaths(storageRoot, smallProjectId);

await rm(paths.projectRoot, { recursive: true, force: true });
await Promise.all([
  mkdir(paths.qivanceDir, { recursive: true }),
  mkdir(paths.timingDir, { recursive: true }),
  mkdir(paths.audioMasterDir, { recursive: true }),
]);
await copyFile(path.join(fixtureDir, "animation_plan.json"), `${paths.qivanceDir}/animation_plan.json`);
await copyFile(path.join(fixtureDir, "section_map.json"), `${paths.timingDir}/section_map.json`);
await copyFile(path.join(fixtureDir, "beat_grid.json"), `${paths.timingDir}/beat_grid.json`);
await copyFile(path.join(fixtureDir, "lyric_word_timing.json"), `${paths.timingDir}/lyric_word_timing.json`);
await copyFile(path.join(fixtureDir, "active_music_take.wav"), `${paths.audioMasterDir}/active_music_take.wav`);

const result = await runHtmlVideoWorkflow(smallProjectId, { storageRoot });
console.log(`Demo complete: ${result.paths.finalMp4Path}`);
