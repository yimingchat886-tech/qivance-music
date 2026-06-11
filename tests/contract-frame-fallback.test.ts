import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeContractFallbackFrames } from "../src/lib/media-e2e/contract-frame-fallback.ts";
import { resolveSmallProjectPaths } from "../src/lib/project-core/paths.ts";
import type { AnimationPlan } from "../src/lib/video-contract/animation-plan.schema.ts";
import { validateFrameOutputs } from "../src/lib/video-html/frame-output-contract-validator.ts";
import type { QivanceFrameContracts } from "../src/lib/video-html/qivance-frame-contracts.ts";

test("writes missing contract fallback frames with locked image refs", async () => {
  const storageRoot = path.join(tmpdir(), `qivance-contract-fallback-${Date.now()}`);
  const paths = resolveSmallProjectPaths(storageRoot, "sp");
  const imagePath = path.join(paths.projectRoot, "assets", "generated-backgrounds", "bg.png");
  await mkdir(path.dirname(imagePath), { recursive: true });
  await writeFile(imagePath, "placeholder");

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
        allowedHtmlPath: "frames/01-scene_001.html",
      },
    },
  };

  const plan: AnimationPlan = {
    schemaVersion: 1,
    smallProjectId: "sp",
    title: "sp",
    category: "ai_concept",
    targetDurationSec: 8,
    fps: 30,
    resolution: { width: 1080, height: 1920 },
    aspectRatio: "9:16",
    mood: "focused",
    synopsis: "test",
    scenes: [
      {
        id: "scene_001",
        order: 0,
        sectionId: "sec_001",
        startSec: 0,
        endSec: 8,
        durationSec: 8,
        frameIntent: "hook",
        headline: "Fallback Hook",
        bodyLines: [],
        captionMode: "line_caption",
        visualDirectives: [],
        beatSync: { intensity: 0.7 },
      },
    ],
  };

  const written = await writeContractFallbackFrames({
    paths,
    contracts,
    animationPlan: plan,
    imageAssets: [{ scene_id: "scene_001", role: "background", path: imagePath }],
  });

  assert.deepEqual(written, ["frames/01-scene_001.html"]);

  const validation = await validateFrameOutputs({
    framesDir: paths.framesDir,
    contracts,
    allowedLocalImagePaths: [imagePath],
  });
  assert.equal(validation.ok, true);

  const secondRun = await writeContractFallbackFrames({
    paths,
    contracts,
    animationPlan: plan,
    imageAssets: [{ scene_id: "scene_001", role: "background", path: imagePath }],
  });
  assert.deepEqual(secondRun, []);
});
