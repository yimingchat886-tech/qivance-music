import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { runHtmlVideoWorkflow } from "../src/lib/video-html/html-video-workflow.ts";

test("html-video workflow builds workspace, frames, preview, and render manifest with injected executors", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-html-video-workflow-"));
  const projectRoot = path.join(storageRoot, "sp_demo_001");
  await mkdir(path.join(projectRoot, "qivance"), { recursive: true });
  await mkdir(path.join(projectRoot, "timing"), { recursive: true });
  await mkdir(path.join(projectRoot, "audio", "master"), { recursive: true });
  await writeFile(path.join(projectRoot, "qivance", "animation_plan.json"), JSON.stringify({
    schemaVersion: 1,
    smallProjectId: "sp_demo_001",
    title: "RAG Rap",
    category: "ai_concept",
    targetDurationSec: 4,
    fps: 30,
    resolution: { width: 1080, height: 1920 },
    aspectRatio: "9:16",
    mood: "cyber rap",
    synopsis: "Teach RAG quickly.",
    scenes: [
      {
        id: "scene_001_hook",
        order: 0,
        sectionId: "sec_hook",
        startSec: 0,
        endSec: 4,
        durationSec: 4,
        frameIntent: "kinetic-rap-hook",
        headline: "RAG checks facts first",
        bodyLines: ["retrieve", "augment", "generate"],
        captionMode: "word_highlight",
        visualDirectives: ["large kinetic type"],
        beatSync: { intensity: 0.9 },
      },
    ],
  }), "utf8");
  await writeFile(path.join(projectRoot, "timing", "section_map.json"), "{}", "utf8");
  await writeFile(path.join(projectRoot, "timing", "beat_grid.json"), "{}", "utf8");
  await writeFile(path.join(projectRoot, "timing", "lyric_word_timing.json"), "{}", "utf8");
  await writeFile(path.join(projectRoot, "audio", "master", "active_music_take.wav"), "audio", "utf8");

  const result = await runHtmlVideoWorkflow("sp_demo_001", {
    storageRoot,
    codexExecutor: async ({ cwd }) => {
      await writeFile(path.join(cwd, "frames", "01-scene_001_hook.html"), "<!doctype html>", "utf8");
      return { stdout: "{\"type\":\"done\"}\n", stderr: "", exitCode: 0 };
    },
    renderVisual: async ({ outputPath }) => {
      await writeFile(outputPath, "visual", "utf8");
    },
    muxAudio: async ({ finalMp4Path }) => {
      await writeFile(finalMp4Path, "final", "utf8");
    },
    probeFinal: async () => ({
      durationSec: 4,
      hasVideoStream: true,
      hasAudioStream: true,
      video: { width: 1080, height: 1920, fps: 30 },
      audio: { durationSec: 4 },
    }),
  });

  await stat(result.paths.contentGraphPath);
  await stat(result.paths.frameContractsPath);
  await stat(result.paths.codexAgentContextPath);
  await stat(result.paths.finalMp4Path);
  await stat(result.paths.renderManifestPath);
  const project = JSON.parse(await readFile(result.paths.projectJsonPath, "utf8"));
  const manifest = JSON.parse(await readFile(result.paths.renderManifestPath, "utf8"));

  assert.equal(result.preview.frames.length, 1);
  assert.equal(project.frames[0].graphNodeId, "scene_001_hook");
  assert.equal(manifest.videoBackend, "html-video");
  assert.equal(manifest.qa.hasAudioStream, true);
});
