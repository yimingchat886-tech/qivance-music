import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateFrameOutputs } from "../src/lib/video-html/frame-output-contract-validator.ts";
import type { QivanceFrameContracts } from "../src/lib/video-html/qivance-frame-contracts.ts";

test("validates frame count, metadata, duration, and locked image refs", async () => {
  const root = path.join(tmpdir(), `qivance-frame-contract-${Date.now()}`);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "01-scene.html"), `
    <script>
      window.__QIVANCE_FRAME = {"graphNodeId":"scene_001","sceneId":"scene_001","durationSec":8,"durationPolicy":"strict"};
    </script>
    <img src="images/bg.png" />
  `);
  const contracts: QivanceFrameContracts = {
    schemaVersion: 1,
    smallProjectId: "sp",
    masterAudioPath: "audio/master/active_music_take.mp3",
    durationPolicy: "strict",
    totalDurationSec: 8,
    frames: {
      scene_001: {
        graphNodeId: "scene_001",
        sceneId: "scene_001",
        order: 0,
        startSec: 0,
        endSec: 8,
        durationSec: 8,
        sectionId: "sec_001",
        strictDuration: true,
        captionMode: "line_caption",
        visualIntensity: 0.7,
        allowedHtmlPath: "frames/01-scene.html",
      },
    },
  };

  const result = await validateFrameOutputs({
    framesDir: root,
    contracts,
    allowedLocalImagePaths: ["images/bg.png"],
  });

  assert.equal(result.ok, true);
  assert.equal(result.frameCount, 1);
});

test("rejects missing metadata and unlocked image refs", async () => {
  const root = path.join(tmpdir(), `qivance-frame-contract-bad-${Date.now()}`);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "01-scene.html"), `<img src="images/unlocked.png" />`);
  const contracts: QivanceFrameContracts = {
    schemaVersion: 1,
    smallProjectId: "sp",
    masterAudioPath: "audio/master/active_music_take.mp3",
    durationPolicy: "strict",
    totalDurationSec: 8,
    frames: {
      scene_001: {
        graphNodeId: "scene_001",
        sceneId: "scene_001",
        order: 0,
        startSec: 0,
        endSec: 8,
        durationSec: 8,
        sectionId: "sec_001",
        strictDuration: true,
        captionMode: "line_caption",
        visualIntensity: 0.7,
        allowedHtmlPath: "frames/01-scene.html",
      },
    },
  };

  const result = await validateFrameOutputs({
    framesDir: root,
    contracts,
    allowedLocalImagePaths: ["images/bg.png"],
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /missing window\.__QIVANCE_FRAME/);
  assert.match(result.issues.join("\n"), /unlocked local image/);
});

