import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveSmallProjectPaths } from "../src/lib/project-core/paths.ts";
import { validateVideoChainBackgroundFrames } from "../src/lib/video-chain/video-chain-runner.ts";
import type { QivanceFrameContracts } from "../src/lib/video-html/qivance-frame-contracts.ts";

test("accepts locked muted MP4 background frames with overlay markers", async () => {
  const { paths, contracts } = await createFrameProject();
  await writeFrame(paths.framesDir, `<!doctype html>
<html>
<body>
  <video src="source_video.mp4" muted defaultMuted autoplay loop playsinline></video>
  <section class="knowledge-card callout">Teaching card</section>
  <script>window.__QIVANCE_FRAME = {"graphNodeId":"scene_001","sceneId":"scene_001","durationSec":2,"durationPolicy":"strict"};</script>
</body>
</html>`);

  const issues = await validateVideoChainBackgroundFrames({ paths, contracts, sourceVideoPath: "source_video.mp4" });

  assert.deepEqual(issues, []);
});

test("rejects unsafe media URLs, controls, unmuted video, source-video audio, and missing overlay", async () => {
  const { paths, contracts } = await createFrameProject();
  await writeFrame(paths.framesDir, `<!doctype html>
<html>
<body>
  <img src="https://example.com/card.png" />
  <video src="https://example.com/source_video.mp4" controls autoplay></video>
  <audio src="source_video.mp4"></audio>
  <audio><source src="blob:source-audio"></audio>
  <script>window.__QIVANCE_FRAME = {"graphNodeId":"scene_001","sceneId":"scene_001","durationSec":2,"durationPolicy":"strict"};</script>
</body>
</html>`);

  const issues = (await validateVideoChainBackgroundFrames({ paths, contracts, sourceVideoPath: "source_video.mp4" })).join("\n");

  assert.match(issues, /img source URL is forbidden/);
  assert.match(issues, /video source URL is forbidden/);
  assert.match(issues, /source source URL is forbidden/);
  assert.match(issues, /video element must not use controls/);
  assert.match(issues, /video element must be muted or defaultMuted/);
  assert.match(issues, /audio element must not reference source video audio/);
  assert.match(issues, /missing locked background video source_video\.mp4/);
  assert.match(issues, /overlay, knowledge-card, callout, card, or keyword marker/);
});

async function createFrameProject(): Promise<{
  paths: ReturnType<typeof resolveSmallProjectPaths>;
  contracts: QivanceFrameContracts;
}> {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-video-chain-frame-"));
  const paths = resolveSmallProjectPaths(storageRoot, "video_chain_project");
  await mkdir(paths.framesDir, { recursive: true });
  return {
    paths,
    contracts: {
      schemaVersion: 1,
      smallProjectId: "video_chain_project",
      masterAudioPath: "active_music_take.mp3",
      durationPolicy: "strict",
      totalDurationSec: 2,
      frames: {
        scene_001: {
          graphNodeId: "scene_001",
          sceneId: "scene_001",
          order: 0,
          startSec: 0,
          endSec: 2,
          durationSec: 2,
          sectionId: "sec_001",
          strictDuration: true,
          captionMode: "keyword_burst",
          visualIntensity: 0.8,
          allowedHtmlPath: "frames/01-scene.html",
        },
      },
    },
  };
}

async function writeFrame(framesDir: string, html: string): Promise<void> {
  await writeFile(path.join(framesDir, "01-scene.html"), html, "utf8");
}
