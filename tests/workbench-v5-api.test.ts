import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const serverPath = fileURLToPath(new URL("../src/server.ts", import.meta.url));

test("V5 API creates DB-backed projects and exposes them through list/detail", async () => {
  const tempRoot = await mkdtemp(path.join("/tmp", "qivance-workbench-v5-api-"));
  const storageRoot = path.join(tempRoot, "projects");
  const port = await getFreePort();
  const server = spawn(process.execPath, ["--experimental-strip-types", serverPath], {
    cwd: tempRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      QIVANCE_PROJECTS_ROOT: "projects",
      QIVANCE_V5_RUNNER: "0",
    },
  });

  try {
    await waitForServer(server, port);
    const baseUrl = `http://127.0.0.1:${port}`;

    const createResponse = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "V5 Product Entry",
        content_type: "chat_dialogue_mv",
        description: "created by API test",
      }),
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.match(created.project_id, /^project_/);
    assert.equal(created.status, "input_required");
    assert.equal(created.chain_id, "chat_dialogue_mv");

    await stat(path.join(storageRoot, created.project_id, "inputs", "lyrics"));
    await stat(path.join(storageRoot, created.project_id, "inputs", "audio"));

    const listResponse = await fetch(`${baseUrl}/api/projects`);
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    assert.equal(list.projects.length, 1);
    assert.equal(list.projects[0].project_id, created.project_id);
    assert.equal(list.projects[0].small_project_id, created.project_id);
    assert.equal(list.projects[0].source, "v5_control_plane");
    assert.equal(list.projects[0].status, "input_required");
    assert.equal(list.projects[0].content_type, "chat_dialogue_mv");

    const detailResponse = await fetch(`${baseUrl}/api/projects/${created.project_id}`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    assert.equal(detail.project.project_id, created.project_id);
    assert.equal(detail.status.status, "input_required");
    assert.equal(detail.status.chains.length, 1);
    assert.equal(detail.status.chains[0].chain_id, "chat_dialogue_mv");
    assert.equal(detail.status.runs.length, 0);

    const lyricsForm = new FormData();
    lyricsForm.set("lyrics_text", "问：hello\n答：world\n");
    const lyricsResponse = await fetch(`${baseUrl}/api/projects/${created.project_id}/inputs`, {
      method: "POST",
      body: lyricsForm,
    });
    assert.equal(lyricsResponse.status, 200);
    assert.equal((await lyricsResponse.json()).status, "input_required");

    const earlyConfirmResponse = await fetch(`${baseUrl}/api/projects/${created.project_id}/inputs/confirm`, {
      method: "POST",
      body: "{}",
    });
    assert.equal(earlyConfirmResponse.status, 409);
    assert.equal((await earlyConfirmResponse.json()).error.code, "inputs_incomplete");

    const audioForm = new FormData();
    audioForm.set("audio_file", new Blob([Buffer.from([1, 2, 3])], { type: "audio/mpeg" }), "take.mp3");
    const audioResponse = await fetch(`${baseUrl}/api/projects/${created.project_id}/inputs`, {
      method: "POST",
      body: audioForm,
    });
    assert.equal(audioResponse.status, 200);
    assert.equal((await audioResponse.json()).status, "input_uploaded");

    const confirmResponse = await fetch(`${baseUrl}/api/projects/${created.project_id}/inputs/confirm`, {
      method: "POST",
      body: "{}",
    });
    assert.equal(confirmResponse.status, 202);
    const confirmed = await confirmResponse.json();
    assert.equal(confirmed.status, "queued");
    assert.equal(confirmed.task_count, 9);
    assert.match(confirmed.run_id, /^run_/);

    const confirmedDetailResponse = await fetch(`${baseUrl}/api/projects/${created.project_id}`);
    assert.equal(confirmedDetailResponse.status, 200);
    const confirmedDetail = await confirmedDetailResponse.json();
    assert.equal(confirmedDetail.status.status, "queued");
    assert.equal(confirmedDetail.status.runs.length, 1);
    assert.equal(confirmedDetail.status.runs[0].tasks.length, 9);
    assert.equal(confirmedDetail.status.runs[0].events[0].event_type, "run_created");

    const replaceForm = new FormData();
    replaceForm.set("replace", "true");
    replaceForm.set("audio_file", new Blob([Buffer.from([4, 5, 6])], { type: "audio/mpeg" }), "replace.mp3");
    const replaceResponse = await fetch(`${baseUrl}/api/projects/${created.project_id}/inputs`, {
      method: "POST",
      body: replaceForm,
    });
    assert.equal(replaceResponse.status, 409);
    assert.equal((await replaceResponse.json()).error.code, "input_replacement_forbidden");

    const stopResponse = await fetch(`${baseUrl}/api/projects/${created.project_id}/runs/${confirmed.run_id}/stop`, {
      method: "POST",
    });
    assert.equal(stopResponse.status, 202);
    const stopped = await stopResponse.json();
    assert.equal(stopped.status, "stop_requested");
    assert.equal(stopped.stopped_task_count, 9);

    const stoppedDetailResponse = await fetch(`${baseUrl}/api/projects/${created.project_id}`);
    assert.equal(stoppedDetailResponse.status, 200);
    const stoppedDetail = await stoppedDetailResponse.json();
    assert.equal(stoppedDetail.status.status, "stopped");
    assert.equal(stoppedDetail.status.runs[0].status, "stopped");

    const invalidResponse = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Invalid", content_type: "video_chain" }),
    });
    assert.equal(invalidResponse.status, 400);
    assert.equal((await invalidResponse.json()).error.code, "unsupported_content_type");
  } finally {
    await stopServer(server);
  }
});

async function getFreePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate port."));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
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
