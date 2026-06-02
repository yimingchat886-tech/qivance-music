import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const serverPath = fileURLToPath(new URL("../src/server.ts", import.meta.url));

test("server serves HyperFrames subpage and safe downloads with a relative storage root", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "qivance-server-"));
  const projectId = "project_server_test";
  const projectPath = path.join(tempRoot, "projects", projectId);
  const downloadBody = JSON.stringify({ sections: [] });
  await mkdir(path.join(projectPath, "data", "timing"), { recursive: true });
  await writeFile(
    path.join(projectPath, "project_manifest.json"),
    JSON.stringify({
      project_id: projectId,
      topic: "Server route test",
      target_duration: 60,
      aspect_ratio: "9:16",
      current_workflow_state: "timing_passed",
      actual_audio_duration: null,
      locked_audio_hash: null,
      preview_video_hash: null,
    }),
    "utf8",
  );
  await writeFile(path.join(projectPath, "data", "timing", "section_map.json"), downloadBody, "utf8");

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

    const hyperframesResponse = await fetch(`http://127.0.0.1:${port}/projects/${projectId}/hyperframes`);
    assert.equal(hyperframesResponse.status, 200);
    assert.match(await hyperframesResponse.text(), /Back to project workbench/);

    const downloadResponse = await fetch(
      `http://127.0.0.1:${port}/projects/${projectId}/download?path=${encodeURIComponent("data/timing/section_map.json")}`,
    );
    assert.equal(downloadResponse.status, 200);
    assert.equal(await downloadResponse.text(), downloadBody);

    const missingResponse = await fetch(
      `http://127.0.0.1:${port}/projects/${projectId}/download?path=${encodeURIComponent("data/timing/missing.json")}`,
    );
    assert.equal(missingResponse.status, 404);

    const traversalResponse = await fetch(
      `http://127.0.0.1:${port}/projects/${projectId}/download?path=${encodeURIComponent("../project_manifest.json")}`,
    );
    assert.equal(traversalResponse.status, 400);
  } finally {
    await stopServer(server);
  }
});

test("server deletes an imported project directory", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "qivance-server-delete-"));
  const projectId = "project_delete_test";
  const projectPath = path.join(tempRoot, "projects", projectId);
  await mkdir(projectPath, { recursive: true });
  await writeFile(
    path.join(projectPath, "project_manifest.json"),
    JSON.stringify({
      project_id: projectId,
      topic: "Delete route test",
      target_duration: 60,
      aspect_ratio: "9:16",
      current_workflow_state: "timing_passed",
      actual_audio_duration: null,
      locked_audio_hash: null,
      preview_video_hash: null,
    }),
    "utf8",
  );

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

    const deleteResponse = await fetch(`http://127.0.0.1:${port}/projects/${projectId}/delete`, {
      method: "POST",
      redirect: "manual",
    });
    assert.equal(deleteResponse.status, 303);
    assert.equal(deleteResponse.headers.get("location"), "/projects");
    await assert.rejects(
      stat(projectPath),
      (error) => error instanceof Error && "code" in error && error.code === "ENOENT",
    );

    const projectsResponse = await fetch(`http://127.0.0.1:${port}/projects`);
    assert.equal(projectsResponse.status, 200);
    assert.doesNotMatch(await projectsResponse.text(), /Delete route test/);
  } finally {
    await stopServer(server);
  }
});
async function getFreePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address) {
          resolve(address.port);
        } else {
          reject(new Error("Failed to allocate a test port."));
        }
      });
    });
  });
}

async function waitForServer(server: ChildProcessWithoutNullStreams, port: number): Promise<void> {
  let stderr = "";
  server.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Server exited before startup. stderr: ${stderr}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/projects`);
      await response.arrayBuffer();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Timed out waiting for server startup. stderr: ${stderr}`);
}

async function stopServer(server: ChildProcessWithoutNullStreams): Promise<void> {
  if (server.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    server.once("exit", () => resolve());
    server.kill();
    setTimeout(() => {
      if (server.exitCode === null) server.kill("SIGKILL");
    }, 1000).unref();
  });
}
