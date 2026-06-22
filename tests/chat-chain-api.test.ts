import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { writeJson } from "../src/lib/fs-utils.ts";

const serverPath = fileURLToPath(new URL("../src/server.ts", import.meta.url));

test("V4 scheduler and chat chain APIs create runs and expose status", async () => {
  const tempRoot = await mkdtemp(path.join("/tmp", "qivance-chat-chain-api-"));
  const storageRoot = path.join(tempRoot, "projects");
  const projectId = "chat_api_001";
  await writeChatProjectFixture(storageRoot, projectId);

  const port = await getFreePort();
  const server = spawn(process.execPath, ["--experimental-strip-types", serverPath], {
    cwd: tempRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      QIVANCE_PROJECTS_ROOT: "projects",
    },
  });

  try {
    await waitForServer(server, port);
    const baseUrl = `http://127.0.0.1:${port}`;

    const chainsResponse = await fetch(`${baseUrl}/api/projects/${projectId}/chains`);
    assert.equal(chainsResponse.status, 200);
    const chains = await chainsResponse.json();
    assert.equal(chains.chains[0].chain_id, "chat_dialogue_mv");
    assert.equal(chains.chains[0].status, "input_ready");

    const conversationResponse = await fetch(`${baseUrl}/api/projects/${projectId}/chains/chat-dialogue-mv/build-conversation-plan`, {
      method: "POST",
      body: "{}",
    });
    assert.equal(conversationResponse.status, 200);
    const conversation = await conversationResponse.json();
    assert.equal(conversation.chain_id, "chat_dialogue_mv");
    assert.equal(conversation.metrics.conversation_message_count, 2);

    const framesResponse = await fetch(`${baseUrl}/api/projects/${projectId}/chains/chat-dialogue-mv/build-frames`, {
      method: "POST",
      body: "{}",
    });
    assert.equal(framesResponse.status, 200);
    const frames = await framesResponse.json();
    assert.equal(frames.render_mode, "browser_recording");
    assert.equal(frames.frames.length, 0);
    assert.equal(frames.runtime_html_path.endsWith("/runtime/chat_dialogue_mv.html"), true);

    const previewResponse = await fetch(`${baseUrl}/api/projects/${projectId}/chains/chat-dialogue-mv/preview`);
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.render_mode, "browser_recording");
    assert.equal(preview.runtime_html.path.endsWith("/runtime/chat_dialogue_mv.html"), true);

    const revisionResponse = await fetch(`${baseUrl}/api/projects/${projectId}/chains/chat-dialogue-mv/revise`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "make the question bubble shorter" }),
    });
    assert.equal(revisionResponse.status, 200);
    const revision = await revisionResponse.json();
    assert.equal(revision.revision_request.data.status, "requested");

    const missingFinalResponse = await fetch(`${baseUrl}/api/projects/${projectId}/chains/chat-dialogue-mv/export/final.mp4`);
    assert.equal(missingFinalResponse.status, 404);

    const runResponse = await fetch(`${baseUrl}/api/projects/${projectId}/chains/chat-dialogue-mv/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ priority: 70 }),
    });
    assert.equal(runResponse.status, 202);
    const runBody = await runResponse.json();
    assert.equal(runBody.run.project_ids[0], projectId);
    assert.deepEqual(runBody.run.chains, ["chat_dialogue_mv"]);
    assert.equal(runBody.plans[0].task_count > 0, true);

    const statusResponse = await fetch(`${baseUrl}/api/scheduler/status`);
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.overall_status, "running");
    assert.deepEqual(status.active_projects, [projectId]);
    assert.deepEqual(status.active_chains, ["chat_dialogue_mv"]);

    const queueResponse = await fetch(`${baseUrl}/api/scheduler/runs`);
    assert.equal(queueResponse.status, 200);
    const queue = await queueResponse.json();
    assert.equal(queue.runs.length, 1);

    const detailResponse = await fetch(`${baseUrl}/api/scheduler/runs/${runBody.run.run_id}`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    assert.equal(detail.run.run_id, runBody.run.run_id);
    assert.equal(detail.data.plans.length, 1);

    const cancelResponse = await fetch(`${baseUrl}/api/scheduler/runs/${runBody.run.run_id}/cancel`, {
      method: "POST",
      body: "{}",
    });
    assert.equal(cancelResponse.status, 200);
    const cancel = await cancelResponse.json();
    assert.equal(cancel.run_id, runBody.run.run_id);

    const runQueue = JSON.parse(await readFile(path.join(storageRoot, "scheduler", "run_queue.json"), "utf8"));
    assert.equal(runQueue.runs[0].status, "cancelled");
  } finally {
    await stopServer(server);
  }
});

test("scheduler API validates missing projects", async () => {
  const tempRoot = await mkdtemp(path.join("/tmp", "qivance-chat-chain-api-"));
  await mkdir(path.join(tempRoot, "projects"), { recursive: true });
  const port = await getFreePort();
  const server = spawn(process.execPath, ["--experimental-strip-types", serverPath], {
    cwd: tempRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      QIVANCE_PROJECTS_ROOT: "projects",
    },
  });

  try {
    await waitForServer(server, port);
    const response = await fetch(`http://127.0.0.1:${port}/api/scheduler/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_ids: ["missing_project"], chains: ["chat_dialogue_mv"] }),
    });

    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "scheduler_project_invalid");
  } finally {
    await stopServer(server);
  }
});

async function writeChatProjectFixture(storageRoot: string, projectId: string): Promise<void> {
  const projectRoot = path.join(storageRoot, projectId);
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "lyrics.md"), "问：hello world?\n答：answer now\n", "utf8");
  await writeFile(path.join(projectRoot, "active_music_take.mp3"), "audio", "utf8");
  for (const artifactPath of ["data/timing/beat_grid.json", "data/timing/onset_events.json", "data/timing/energy_curve.json", "data/timing/alignment_report.json"]) {
    await writeJson(path.join(projectRoot, artifactPath), { schema_version: 1, path: artifactPath });
  }
  await writeJson(path.join(projectRoot, "data/timing/lyric_word_timing.json"), {
    schema_version: 1,
    duration_sec: 4,
    words: [
      { line_id: "line_001", word: "hello", start_sec: 0.2, end_sec: 0.5 },
      { line_id: "line_001", word: "world", start_sec: 0.6, end_sec: 0.9 },
      { line_id: "line_002", word: "answer", start_sec: 1.2, end_sec: 1.5 },
      { line_id: "line_002", word: "now", start_sec: 1.6, end_sec: 1.9 },
    ],
  });
  await writeJson(path.join(projectRoot, "data/timing/section_map.json"), {
    duration_sec: 4,
    sections: [{ section_id: "sec_001", start_sec: 0, end_sec: 4 }],
  });
}

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
