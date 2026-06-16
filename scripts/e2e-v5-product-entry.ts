import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { closeQivancePrismaClient, createQivancePrismaClient } from "../src/lib/db/prisma-client.ts";

const execFileAsync = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(repoRoot, "src/server.ts");
const allowTimingBlocked = process.argv.includes("--allow-timing-blocked");
const timeoutMs = Number(argValue("--timeout-ms") ?? 180_000);

const root = await mkdtemp(path.join(tmpdir(), "qivance-e2e-v5-"));
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
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
  },
});

try {
  await waitForServer(server, port);
  const baseUrl = `http://127.0.0.1:${port}`;
  const audio = await createSpeechMp3(root);
  const stopEvidence = await runStopAndReplaceScenario(baseUrl, audio);
  const happy = await runHappyPath(baseUrl, audio);

  if (happy.status !== "passed") {
    if (allowTimingBlocked && happy.status === "blocked" && /timing_blocked/.test(happy.lastError ?? "")) {
      console.log(JSON.stringify({
        status: "blocked_timing_dependency",
        storage_root: storageRoot,
        happy_path: happy,
        stop_replace: stopEvidence,
      }, null, 2));
      process.exitCode = 0;
    } else {
      throw new Error(`V5 happy path did not pass: ${JSON.stringify(happy)}`);
    }
  } else {
    await verifyFinalArtifacts(storageRoot, happy.projectId, happy.runId);
    console.log(JSON.stringify({
      status: "passed",
      storage_root: storageRoot,
      happy_path: happy,
      stop_replace: stopEvidence,
    }, null, 2));
  }
} finally {
  await stopServer(server);
}

async function runHappyPath(baseUrl: string, audio: Buffer): Promise<{
  projectId: string;
  runId: string;
  status: string;
  lastError?: string | null;
}> {
  const projectId = await createProject(baseUrl, "V5 E2E Happy Path");
  await uploadInputs(baseUrl, projectId, audio);
  const confirmed = await postJson(`${baseUrl}/api/projects/${projectId}/inputs/confirm`, {});
  assert.equal(confirmed.status, "queued");
  const terminal = await waitForTerminalRun(baseUrl, projectId, confirmed.run_id, timeoutMs);
  if (terminal.status === "passed") {
    const finalResponse = await fetch(`${baseUrl}/api/projects/${projectId}/chains/chat-dialogue-mv/export/final.mp4`);
    assert.equal(finalResponse.status, 200);
  }
  return {
    projectId,
    runId: confirmed.run_id,
    status: terminal.status,
    lastError: terminal.last_error,
  };
}

async function runStopAndReplaceScenario(baseUrl: string, audio: Buffer): Promise<Record<string, unknown>> {
  const projectId = await createProject(baseUrl, "V5 E2E Stop Replace");
  await uploadInputs(baseUrl, projectId, audio);
  const confirmed = await postJson(`${baseUrl}/api/projects/${projectId}/inputs/confirm`, {});
  const stopped = await postJson(`${baseUrl}/api/projects/${projectId}/runs/${confirmed.run_id}/stop`, {});
  assert.equal(stopped.status, "stop_requested");
  const stoppedDetail = await getJson(`${baseUrl}/api/projects/${projectId}`);
  assert.equal(stoppedDetail.status.runs[0].status, "stopped");

  await uploadInputs(baseUrl, projectId, audio, true);
  const second = await postJson(`${baseUrl}/api/projects/${projectId}/inputs/confirm`, {});
  assert.match(second.run_id, /^run_/);
  assert.notEqual(second.run_id, confirmed.run_id);
  await postJson(`${baseUrl}/api/projects/${projectId}/runs/${second.run_id}/stop`, {});
  return {
    project_id: projectId,
    stopped_run_id: confirmed.run_id,
    replacement_run_id: second.run_id,
  };
}

async function createProject(baseUrl: string, title: string): Promise<string> {
  const created = await postJson(`${baseUrl}/api/projects`, {
    title,
    content_type: "chat_dialogue_mv",
    description: "V5 product-entry E2E",
  });
  assert.equal(created.status, "input_required");
  return created.project_id;
}

async function uploadInputs(baseUrl: string, projectId: string, audio: Buffer, replace = false): Promise<void> {
  const form = new FormData();
  form.set("lyrics_text", "Q: hello world answer now\n");
  const audioBytes = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
  form.set("audio_file", new Blob([audioBytes], { type: "audio/mpeg" }), "take.mp3");
  if (replace) form.set("replace", "true");
  const response = await fetch(`${baseUrl}/api/projects/${projectId}/inputs`, { method: "POST", body: form });
  const json = await response.json();
  assert.equal(response.status, 200, JSON.stringify(json));
  assert.equal(json.status, "input_uploaded");
}

async function waitForTerminalRun(baseUrl: string, projectId: string, runId: string, maxWaitMs: number): Promise<{
  status: string;
  last_error?: string | null;
}> {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const detail = await getJson(`${baseUrl}/api/projects/${projectId}`);
    const run = detail.status.runs.find((candidate: { id: string }) => candidate.id === runId);
    if (!run) throw new Error(`Run not found in project detail: ${runId}`);
    if (["passed", "failed", "blocked", "stopped"].includes(run.status)) {
      const failedTask = run.tasks.find((task: { last_error?: string | null }) => task.last_error);
      return { status: run.status, last_error: failedTask?.last_error ?? null };
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for V5 run ${runId}`);
}

async function verifyFinalArtifacts(storageRootValue: string, projectId: string, runId: string): Promise<void> {
  const projectRoot = path.join(storageRootValue, projectId);
  for (const relativePath of [
    "data/timing/beat_grid.json",
    "data/timing/onset_events.json",
    "data/timing/energy_curve.json",
    "data/timing/lyric_word_timing.json",
    "data/timing/alignment_report.json",
    "data/timing/section_map.json",
    "data/chains/chat_dialogue_mv/qa_report.json",
    "exports/chat_dialogue_mv/final.mp4",
    "exports/chat_dialogue_mv/render_manifest.json",
  ]) {
    assert.equal((await stat(path.join(projectRoot, relativePath))).isFile(), true, relativePath);
  }
  const manifest = JSON.parse(await readFile(path.join(projectRoot, "exports/chat_dialogue_mv/render_manifest.json"), "utf8"));
  assert.equal(manifest.chain.run_id, runId);
  assert.equal(manifest.production_gates.diagnostic_only, false);

  const prisma = await createQivancePrismaClient(storageRootValue);
  try {
    const artifacts = await prisma.artifact.findMany({ where: { projectId, status: "current" } });
    assert.ok(artifacts.some((artifact) => artifact.path === "exports/chat_dialogue_mv/final.mp4"));
    assert.ok(artifacts.some((artifact) => artifact.path === "exports/chat_dialogue_mv/render_manifest.json"));
  } finally {
    await closeQivancePrismaClient(prisma);
  }
}

async function createSpeechMp3(rootDir: string): Promise<Buffer> {
  const audioPath = path.join(rootDir, "speech.mp3");
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "flite=text='hello world answer now':voice=slt",
    "-t",
    "2",
    audioPath,
  ]);
  return readFile(audioPath);
}

async function postJson(url: string, body: Record<string, unknown>): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${response.status} ${JSON.stringify(json)}`);
  return json;
}

async function getJson(url: string): Promise<any> {
  const response = await fetch(url);
  const json = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${response.status} ${JSON.stringify(json)}`);
  return json;
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

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
