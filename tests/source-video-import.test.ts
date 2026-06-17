import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { resolveSmallProjectPaths } from "../src/lib/project-core/paths.ts";
import { buildAgentContext } from "../src/lib/video-contract/agent-context.schema.ts";
import type { AnimationPlan } from "../src/lib/video-contract/animation-plan.schema.ts";
import { importSourceVideoAsset } from "../src/lib/video-html/source-video-import.ts";
import { SOURCE_VIDEO_FIXTURE_PROBE, writeSourceVideoFixture } from "./source-video-fixture.ts";

test("imports a project-local MP4 and records ffprobe and sha evidence", async () => {
  const projectRoot = await mkdtemp(path.join("/tmp", "qivance-source-video-import-"));
  const fixture = await writeSourceVideoFixture({ projectRoot });

  const result = await importSourceVideoAsset({
    projectRoot,
    smallProjectId: "source_video_demo",
    sourcePath: "source_video.mp4",
    importedAt: "2026-06-12T00:00:00.000Z",
    probe: async () => fixture.probe,
  });
  const written = JSON.parse(await readFile(path.join(projectRoot, result.path), "utf8"));

  assert.equal(result.path, "data/source/source_video_import.json");
  assert.equal(result.importFile.status, "locked");
  assert.equal(result.importFile.audio_policy, "preserve_source_audio");
  assert.equal(result.importFile.source_video.path, "source_video.mp4");
  assert.equal(result.importFile.source_video.sha256, fixture.sha256);
  assert.equal(result.importFile.source_video.duration_sec, 24);
  assert.equal(result.importFile.source_video.width, 1080);
  assert.equal(result.importFile.source_video.height, 1920);
  assert.equal(result.importFile.source_video.video_codec, "h264");
  assert.equal(result.importFile.source_video.audio_streams, 1);
  assert.equal(result.importFile.source_video.audio_codec, "aac");
  assert.equal(written.provenance.imported_at, "2026-06-12T00:00:00.000Z");
});

test("copies an external local MP4 into the project before locking it", async () => {
  const root = await mkdtemp(path.join("/tmp", "qivance-source-video-copy-"));
  const projectRoot = path.join(root, "project");
  const externalPath = path.join(root, "external.mp4");
  await mkdir(projectRoot, { recursive: true });
  const external = await writeSourceVideoFixture({ projectRoot: root, relativePath: "external.mp4" });

  const result = await importSourceVideoAsset({
    projectRoot,
    smallProjectId: "source_video_demo",
    sourcePath: externalPath,
    probe: async () => external.probe,
  });
  const copied = await readFile(path.join(projectRoot, "source_video.mp4"));

  assert.equal(result.importFile.source_video.path, "source_video.mp4");
  assert.equal(copied.toString(), external.bytes.toString());
});

test("rejects remote URLs and unusable media probes", async () => {
  const projectRoot = await mkdtemp(path.join("/tmp", "qivance-source-video-reject-"));
  await assert.rejects(
    () => importSourceVideoAsset({
      projectRoot,
      smallProjectId: "source_video_demo",
      sourcePath: "https://example.com/video.mp4",
      probe: async () => SOURCE_VIDEO_FIXTURE_PROBE,
    }),
    /Remote URL/,
  );
  await writeSourceVideoFixture({ projectRoot });
  await assert.rejects(
    () => importSourceVideoAsset({
      projectRoot,
      smallProjectId: "source_video_demo",
      sourcePath: "source_video.mp4",
      probe: async () => ({ ...SOURCE_VIDEO_FIXTURE_PROBE, hasAudioStream: false, audioStreamCount: 0, audio: undefined }),
    }),
    /requires an audio stream/,
  );
});

test("background video policy accepts silent MP4 probes", async () => {
  const projectRoot = await mkdtemp(path.join("/tmp", "qivance-source-video-background-"));
  const fixture = await writeSourceVideoFixture({ projectRoot });

  const result = await importSourceVideoAsset({
    projectRoot,
    smallProjectId: "source_video_demo",
    sourcePath: "source_video.mp4",
    audioPolicy: "background_video_only",
    probe: async () => ({
      ...fixture.probe,
      hasAudioStream: false,
      audioStreamCount: 0,
      audio: undefined,
    }),
  });

  assert.equal(result.importFile.audio_policy, "background_video_only");
  assert.equal(result.importFile.source_video.audio_streams, 0);
});

test("agent context can expose the locked local source video asset", async () => {
  const storageRoot = await mkdtemp(path.join("/tmp", "qivance-source-video-context-"));
  const paths = resolveSmallProjectPaths(storageRoot, "source_video_demo");
  await mkdir(paths.projectRoot, { recursive: true });
  const fixture = await writeSourceVideoFixture({ projectRoot: paths.projectRoot });
  const result = await importSourceVideoAsset({
    projectRoot: paths.projectRoot,
    smallProjectId: "source_video_demo",
    sourcePath: "source_video.mp4",
    probe: async () => fixture.probe,
  });

  const context = buildAgentContext({
    plan: planFixture(),
    paths,
    sourceVideoImport: result.importFile,
  });

  assert.equal(context.sourceVideo.enabled, true);
  if (context.sourceVideo.enabled) {
    assert.equal(context.sourceVideo.status, "locked");
    assert.equal(context.sourceVideo.path, "source_video.mp4");
    assert.equal(context.sourceVideo.audioPolicy, "preserve_source_audio");
    assert.equal(context.sourceVideo.sha256, result.importFile.source_video.sha256);
  }
});

function planFixture(): AnimationPlan {
  return {
    schemaVersion: 1,
    smallProjectId: "source_video_demo",
    title: "source_video_demo",
    category: "ai_concept",
    targetDurationSec: 24,
    fps: 30,
    resolution: { width: 1080, height: 1920 },
    aspectRatio: "9:16",
    mood: "focused",
    synopsis: "source video test",
    scenes: [
      {
        id: "scene_001",
        order: 0,
        sectionId: "sec_001",
        startSec: 0,
        endSec: 24,
        durationSec: 24,
        frameIntent: "source video",
        headline: "Source Video",
        bodyLines: [],
        captionMode: "line_caption",
        visualDirectives: [],
        beatSync: { intensity: 0.5 },
      },
    ],
  };
}
