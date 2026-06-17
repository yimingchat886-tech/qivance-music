import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, readFile, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resolveSmallProjectPaths } from "../src/lib/project-core/paths.ts";
import { buildAgentContext } from "../src/lib/video-contract/agent-context.schema.ts";
import type { AnimationPlan } from "../src/lib/video-contract/animation-plan.schema.ts";
import { importSourceVideoAsset } from "../src/lib/video-html/source-video-import.ts";
import { SOURCE_VIDEO_FIXTURE_PROBE, writeSourceVideoFixture } from "./source-video-fixture.ts";

const serverPath = fileURLToPath(new URL("../src/server.ts", import.meta.url));

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
  await assert.rejects(
    () => importSourceVideoAsset({
      projectRoot,
      smallProjectId: "source_video_demo",
      sourcePath: "source_video.mp4",
      probe: async () => ({
        ...SOURCE_VIDEO_FIXTURE_PROBE,
        hasVideoStream: false,
        videoStreamCount: 0,
        video: undefined,
      }),
    }),
    /requires a readable MP4/,
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

test("API maps source video import and confirm MP4 failures to clear 409 errors", async () => {
  const tempRoot = await mkdtemp(path.join("/tmp", "qivance-source-video-api-"));
  const storageRoot = path.join(tempRoot, "projects");
  const port = await getFreePort();
  const server = spawn(process.execPath, ["--experimental-strip-types", serverPath], {
    cwd: tempRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      QIVANCE_PROJECTS_ROOT: storageRoot,
      QIVANCE_V5_RUNNER: "0",
    },
  });

  try {
    await waitForServer(server, port);
    const baseUrl = `http://127.0.0.1:${port}`;
    const created = await postJson(`${baseUrl}/api/projects`, {
      title: "Video Chain Import Errors",
      content_type: "video_chain",
    }, 201);

    const missingImportResponse = await fetch(`${baseUrl}/api/projects/${created.project_id}/source-video/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_path: "missing.mp4" }),
    });
    const missingImport = await missingImportResponse.json();
    assert.equal(missingImportResponse.status, 409);
    assert.equal(missingImport.error.code, "source_video_import_failed");

    const form = new FormData();
    form.set("lyrics_text", "line one\nline two\n");
    form.set("audio_file", new Blob([Buffer.from([1, 2, 3])], { type: "audio/mpeg" }), "take.mp3");
    form.set("video_file", new Blob([Buffer.from("not a real mp4")], { type: "video/mp4" }), "fake.mp4");
    const uploadResponse = await fetch(`${baseUrl}/api/projects/${created.project_id}/inputs`, {
      method: "POST",
      body: form,
    });
    assert.equal(uploadResponse.status, 200, JSON.stringify(await uploadResponse.json()));

    const confirmResponse = await fetch(`${baseUrl}/api/projects/${created.project_id}/inputs/confirm`, {
      method: "POST",
      body: "{}",
    });
    const confirm = await confirmResponse.json();
    assert.equal(confirmResponse.status, 409);
    assert.equal(confirm.error.code, "source_video_import_failed");
    assert.match(confirm.error.message, /Source video|source video|ffprobe|Invalid data|moov atom|Error opening input|ENOENT|No such file/i);

    const chatCreated = await postJson(`${baseUrl}/api/projects`, {
      title: "Input File Missing",
      content_type: "chat_dialogue_mv",
    }, 201);
    const chatForm = new FormData();
    chatForm.set("lyrics_text", "line one\nline two\n");
    chatForm.set("audio_file", new Blob([Buffer.from([1, 2, 3])], { type: "audio/mpeg" }), "take.mp3");
    const chatUploadResponse = await fetch(`${baseUrl}/api/projects/${chatCreated.project_id}/inputs`, {
      method: "POST",
      body: chatForm,
    });
    const chatUpload = await chatUploadResponse.json();
    assert.equal(chatUploadResponse.status, 200, JSON.stringify(chatUpload));
    const audioInput = chatUpload.inputs.find((input: { kind: string; path: string }) => input.kind === "audio");
    assert.ok(audioInput, "audio input should be returned");
    await unlink(path.join(chatCreated.project_root, audioInput.path));
    const missingInputConfirmResponse = await fetch(`${baseUrl}/api/projects/${chatCreated.project_id}/inputs/confirm`, {
      method: "POST",
      body: "{}",
    });
    const missingInputConfirm = await missingInputConfirmResponse.json();
    assert.equal(missingInputConfirmResponse.status, 409);
    assert.equal(missingInputConfirm.error.code, "input_file_missing");
  } finally {
    await stopServer(server);
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

async function postJson(url: string, body: Record<string, unknown>, expectedStatus = 200): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  assert.equal(response.status, expectedStatus, JSON.stringify(json));
  return json;
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate port."));
        return;
      }
      probe.close(() => resolve(address.port));
    });
    probe.on("error", reject);
  });
}

async function waitForServer(server: ChildProcessWithoutNullStreams, port: number): Promise<void> {
  const started = Date.now();
  let stderr = "";
  server.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  while (Date.now() - started < 5000) {
    if (server.exitCode !== null) throw new Error(`Server exited early: ${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/projects`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Server did not start: ${stderr}`);
}

async function stopServer(server: ChildProcessWithoutNullStreams): Promise<void> {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await new Promise<void>((resolve) => server.once("exit", () => resolve()));
}
