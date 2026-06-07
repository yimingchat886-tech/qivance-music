import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { resolveSmallProjectPaths } from "../src/lib/project-core/paths.ts";
import { loadHtmlVideoPreviewModel, resolvePreviewFramePath } from "../src/lib/video-html/preview-model.ts";
import { parseFfprobeJson } from "../src/lib/export/ffprobe.ts";
import { buildRenderManifest } from "../src/lib/export/render-manifest.ts";

test("preview model reads ordered html-video frame records", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-preview-"));
  const paths = resolveSmallProjectPaths(storageRoot, "sp_demo_001");
  await mkdir(paths.framesDir, { recursive: true });
  await writeFile(paths.projectJsonPath, JSON.stringify({
    id: "sp_demo_001",
    frames: [
      { graphNodeId: "scene_002", htmlPath: `${paths.framesDir}/02-scene_002.html`, durationSec: 3, order: 1 },
      { graphNodeId: "scene_001", htmlPath: `${paths.framesDir}/01-scene_001.html`, durationSec: 5, order: 0 },
    ],
  }), "utf8");
  await writeFile(paths.contentGraphPath, JSON.stringify({ schemaVersion: 1, intent: "explainer", nodes: [], edges: [] }), "utf8");
  await writeFile(paths.frameContractsPath, JSON.stringify({
    schemaVersion: 1,
    smallProjectId: "sp_demo_001",
    durationPolicy: "strict",
    totalDurationSec: 8,
    frames: {},
  }), "utf8");
  await writeFile(path.join(paths.framesDir, "01-scene_001.html"), "<!doctype html>", "utf8");

  const model = await loadHtmlVideoPreviewModel(paths);

  assert.equal(model.smallProjectId, "sp_demo_001");
  assert.equal(model.htmlVideoProjectId, "sp_demo_001");
  assert.equal(model.totalDurationSec, 8);
  assert.deepEqual(model.frames.map((frame) => frame.graphNodeId), ["scene_001", "scene_002"]);
  assert.equal(model.frames[0].previewUrl, "/preview/sp_demo_001/frames/01-scene_001.html");
  assert.equal(resolvePreviewFramePath(paths, "01-scene_001.html"), `${paths.framesDir}/01-scene_001.html`);
  assert.throws(() => resolvePreviewFramePath(paths, "../project.json"), /Invalid preview frame filename/);
  assert.equal(await readFile(path.join(paths.framesDir, "01-scene_001.html"), "utf8"), "<!doctype html>");
});

test("ffprobe parser and render manifest record stream QA", () => {
  const probe = parseFfprobeJson(JSON.stringify({
    format: { duration: "8.04" },
    streams: [
      { codec_type: "video", width: 1080, height: 1920, r_frame_rate: "30/1" },
      { codec_type: "audio", duration: "8.01" },
    ],
  }));
  const manifest = buildRenderManifest({
    smallProjectId: "sp_demo_001",
    contentGraphPath: "video/html-video/.html-video/projects/sp_demo_001/content-graph.json",
    frameContractsPath: "video/html-video/.html-video/projects/sp_demo_001/qivance-frame-contracts.json",
    visualMp4Path: "exports/visual.mp4",
    masterAudioPath: "audio/master/active_music_take.wav",
    finalMp4Path: "exports/final.mp4",
    expected: { durationSec: 8, fps: 30, resolution: { width: 1080, height: 1920 } },
    finalProbe: probe,
  });

  assert.equal(manifest.videoBackend, "html-video");
  assert.equal(manifest.engine, "qivance-hyperframes-strict");
  assert.equal(manifest.durationPolicy, "strict");
  assert.equal(manifest.qa.hasVideoStream, true);
  assert.equal(manifest.qa.hasAudioStream, true);
  assert.equal(manifest.qa.resolutionOk, true);
  assert.equal(manifest.qa.fpsOk, true);
  assert.equal(manifest.qa.durationDriftSec, 0.04);
});
