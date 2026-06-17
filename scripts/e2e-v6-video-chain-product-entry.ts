import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { validateRenderManifestV6 } from "../src/lib/export/render-manifest-v6.ts";

const execFileAsync = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(repoRoot, "src/server.ts");
const allowBlocked = process.argv.includes("--allow-blocked");
const timeoutMs = Number(argValue("--timeout-ms") ?? 180_000);

await main();

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "qivance-e2e-v6-"));
  const storageRoot = path.join(root, "projects");
  const port = await getFreePort();
  const server = spawn(process.execPath, ["--experimental-strip-types", serverPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      QIVANCE_PROJECTS_ROOT: storageRoot,
      QIVANCE_V5_RUNNER_INTERVAL_MS: "2000",
      QIVANCE_WHISPERX_DEVICE: process.env.QIVANCE_WHISPERX_DEVICE ?? "cpu",
      QIVANCE_WHISPERX_REQUIRE_GPU: process.env.QIVANCE_WHISPERX_REQUIRE_GPU ?? "0",
      QIVANCE_WHISPERX_LANGUAGE: process.env.QIVANCE_WHISPERX_LANGUAGE ?? "en",
      QIVANCE_WHISPERX_MODEL: process.env.QIVANCE_WHISPERX_MODEL ?? "tiny",
      QIVANCE_WHISPERX_CACHE_DIR: process.env.QIVANCE_WHISPERX_CACHE_DIR ?? path.join(root, "hf-cache"),
      QIVANCE_WHISPERX_TIMEOUT_MS: process.env.QIVANCE_WHISPERX_TIMEOUT_MS ?? "30000",
      QIVANCE_HTML_VIDEO_RUNTIME_TIMEOUT_MS: process.env.QIVANCE_HTML_VIDEO_RUNTIME_TIMEOUT_MS ?? "120000",
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
    },
  });

  try {
    await waitForServer(server, port);
    const baseUrl = `http://127.0.0.1:${port}`;
    let audio: Buffer;
    let video: Buffer;
    try {
      audio = await createToneMp3(root);
      video = await createSourceMp4(root);
    } catch (error) {
      if (!allowBlocked) throw error;
      emitBlocked("local_fixture_dependency", storageRoot, { error: errorMessage(error) });
      return;
    }

    const projectId = await createProject(baseUrl);
    await uploadInputs(baseUrl, projectId, audio, video);
    const confirmed = await postJson(`${baseUrl}/api/projects/${projectId}/inputs/confirm`, {}, 202);
    assert.equal(confirmed.status, "queued");
    assert.equal(confirmed.task_count, 3);

    const preview = await waitForTerminalRun(baseUrl, projectId, confirmed.run_id, timeoutMs);
    if (preview.status !== "ready") {
      handleNonPassingRun("preview", storageRoot, projectId, preview);
      return;
    }
    await assertPreviewOnlyArtifacts(storageRoot, projectId);

    const exportRun = await postJson(`${baseUrl}/api/projects/${projectId}/chains/video-chain/export/render`, {}, 202);
    assert.equal(exportRun.mode, "production_export");
    assert.equal(exportRun.task_count, 4);

    const exported = await waitForTerminalRun(baseUrl, projectId, exportRun.run_id, timeoutMs);
    if (exported.status !== "passed") {
      handleNonPassingRun("export", storageRoot, projectId, exported);
      return;
    }
    await verifyFinalArtifacts(baseUrl, storageRoot, projectId, exportRun.run_id);
    console.log(JSON.stringify({
      status: "passed",
      evidence_kind: "real_html_video_e2e",
      storage_root: storageRoot,
      project_id: projectId,
      preview_run_id: confirmed.run_id,
      export_run_id: exportRun.run_id,
    }, null, 2));
  } finally {
    await stopServer(server);
  }
}

async function createProject(baseUrl: string): Promise<string> {
  const created = await postJson(`${baseUrl}/api/projects`, {
    title: "V6 Video Chain E2E",
    content_type: "video_chain",
    description: "V6 product-entry E2E",
  }, 201);
  assert.equal(created.status, "input_required");
  assert.equal(created.chain_id, "video_chain");
  return created.project_id;
}

async function uploadInputs(baseUrl: string, projectId: string, audio: Buffer, video: Buffer): Promise<void> {
  const form = new FormData();
  form.set("lyrics_text", "First idea\nSecond card\nThird callout\nFourth proof\n");
  form.set("audio_file", new Blob([bufferArrayBuffer(audio)], { type: "audio/mpeg" }), "take.mp3");
  form.set("video_file", new Blob([bufferArrayBuffer(video)], { type: "video/mp4" }), "background.mp4");
  const response = await fetch(`${baseUrl}/api/projects/${projectId}/inputs`, { method: "POST", body: form });
  const json = await response.json().catch(() => ({}));
  assert.equal(response.status, 200, JSON.stringify(json));
  assert.equal(json.status, "input_uploaded");
}

async function waitForTerminalRun(baseUrl: string, projectId: string, runId: string, maxWaitMs: number): Promise<{
  status: string;
  mode?: string;
  failed_task_stage?: string;
  last_error?: string | null;
}> {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const detail = await getJson(`${baseUrl}/api/projects/${projectId}`);
    const run = detail.status.runs.find((candidate: { id: string }) => candidate.id === runId);
    if (!run) throw new Error(`Run not found in project detail: ${runId}`);
    if (["ready", "passed", "failed", "blocked", "stopped"].includes(run.status)) {
      const failedTask = run.tasks.find((task: { status: string; last_error?: string | null }) => task.last_error || ["failed", "blocked"].includes(task.status));
      return {
        status: run.status,
        mode: run.mode,
        failed_task_stage: failedTask?.stage,
        last_error: failedTask?.last_error ?? null,
      };
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for V6 run ${runId}`);
}

function handleNonPassingRun(
  phase: "preview" | "export",
  storageRoot: string,
  projectId: string,
  run: { status: string; failed_task_stage?: string; last_error?: string | null },
): void {
  const blockedReason = blockedDependencyReason(phase, run);
  if (allowBlocked && blockedReason) {
    emitBlocked(blockedReason, storageRoot, {
      project_id: projectId,
      phase,
      run_status: run.status,
      failed_task_stage: run.failed_task_stage,
      last_error: run.last_error,
    });
    return;
  }
  throw new Error(`V6 ${phase} did not pass: ${JSON.stringify(run)}`);
}

function blockedDependencyReason(phase: "preview" | "export", run: { failed_task_stage?: string; last_error?: string | null }): string | null {
  const message = run.last_error ?? "";
  if (/timing_blocked|No module named|ModuleNotFoundError|cuda|gpu|download|network|librosa|whisperx/i.test(message)) {
    return "timing_dependency";
  }
  if (phase === "preview" && run.failed_task_stage === "build_video_frames" && /html_video|video_chain_agent_failed|missing frame|codex|agent|runtime/i.test(message)) {
    return "html_video_runtime_dependency";
  }
  if (phase === "export" && run.failed_task_stage === "render_video_visual" && /chromium|playwright|browser|render|html-video/i.test(message)) {
    return "html_video_render_dependency";
  }
  if (phase === "export" && run.failed_task_stage === "mux_video_final" && /ffmpeg|mux|No such file|ENOENT/i.test(message)) {
    return "ffmpeg_mux_dependency";
  }
  return null;
}

function emitBlocked(reason: string, storageRoot: string, details: Record<string, unknown>): void {
  console.log(JSON.stringify({
    status: "blocked_dependency",
    evidence_kind: "real_html_video_e2e_blocked",
    reason,
    storage_root: storageRoot,
    details,
  }, null, 2));
}

async function assertPreviewOnlyArtifacts(storageRoot: string, projectId: string): Promise<void> {
  const projectRoot = path.join(storageRoot, projectId);
  await assertFile(projectRoot, "data/source/source_video_import.json");
  await assertFile(projectRoot, "data/chains/video_chain/video_animation_plan.json");
  await assertFile(projectRoot, "data/chains/video_chain/frame_contracts.json");
  assert.equal(await fileExists(path.join(projectRoot, "exports/video_chain/final.mp4")), false, "preview must not create final.mp4");
  assert.equal(await fileExists(path.join(projectRoot, "exports/video_chain/render_manifest.json")), false, "preview must not create render_manifest.json");
}

async function verifyFinalArtifacts(baseUrl: string, storageRoot: string, projectId: string, runId: string): Promise<void> {
  const projectRoot = path.join(storageRoot, projectId);
  for (const relativePath of [
    "exports/video_chain/visual.mp4",
    "exports/video_chain/final.mp4",
    "data/chains/video_chain/qa_report.json",
    "exports/video_chain/render_manifest.json",
  ]) {
    await assertFile(projectRoot, relativePath);
  }
  const manifest = JSON.parse(await readFile(path.join(projectRoot, "exports/video_chain/render_manifest.json"), "utf8"));
  assert.equal(manifest.chain.run_id, runId);
  const validation = validateRenderManifestV6(manifest);
  assert.equal(validation.ok, true, validation.issues.join("\n"));
  const finalResponse = await fetch(`${baseUrl}/api/projects/${projectId}/chains/video-chain/export/final.mp4`);
  assert.equal(finalResponse.status, 200);
}

async function createToneMp3(rootDir: string): Promise<Buffer> {
  const audioPath = path.join(rootDir, "tone.mp3");
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    "-f",
    "mp3",
    audioPath,
  ]);
  return readFile(audioPath);
}

async function createSourceMp4(rootDir: string): Promise<Buffer> {
  const videoPath = path.join(rootDir, "source.mp4");
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=30",
    "-t",
    "2",
    "-pix_fmt",
    "yuv420p",
    "-an",
    videoPath,
  ]);
  return readFile(videoPath);
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

async function getJson(url: string): Promise<any> {
  const response = await fetch(url);
  const json = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${response.status} ${JSON.stringify(json)}`);
  return json;
}

async function assertFile(projectRoot: string, relativePath: string): Promise<void> {
  assert.equal((await stat(path.join(projectRoot, relativePath))).isFile(), true, relativePath);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function waitForServer(server: ChildProcessWithoutNullStreams, portValue: number): Promise<void> {
  const started = Date.now();
  let stderr = "";
  server.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  while (Date.now() - started < 10_000) {
    if (server.exitCode !== null) throw new Error(`Server exited early: ${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${portValue}/api/projects`);
      if (response.ok) return;
    } catch {
      await delay(100);
    }
  }
  throw new Error(`Server did not start: ${stderr}`);
}

async function stopServer(server: ChildProcessWithoutNullStreams): Promise<void> {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await new Promise<void>((resolve) => server.once("exit", () => resolve()));
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

function bufferArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
