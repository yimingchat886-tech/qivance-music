import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resolveSmallProjectPaths } from "../src/lib/project-core/paths.ts";

const serverPath = fileURLToPath(new URL("../src/server.ts", import.meta.url));

test("server exposes html-video preview API and sanitized frame files", async () => {
  const tempRoot = await mkdtemp(path.join("/tmp", "qivance-html-video-server-"));
  const storageRoot = path.join(tempRoot, "projects");
  const smallProjectId = "project_server_html_video";
  const paths = resolveSmallProjectPaths(storageRoot, smallProjectId);

  await mkdir(paths.framesDir, { recursive: true });
  await writeFile(
    paths.projectJsonPath,
    JSON.stringify({
      id: smallProjectId,
      frames: [
        {
          graphNodeId: "scene_001",
          order: 1,
          durationSec: 2,
          htmlPath: "frames/01-scene_001.html",
        },
      ],
    }),
    "utf8",
  );
  await writeFile(
    paths.frameContractsPath,
    JSON.stringify({
      schemaVersion: "qivance.frame_contracts.v1",
      projectId: smallProjectId,
      durationPolicy: "strict",
      totalDurationSec: 2,
      frames: [],
    }),
    "utf8",
  );
  await writeFile(path.join(paths.framesDir, "01-scene_001.html"), "<!doctype html><h1>Scene 1</h1>", "utf8");

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

    const previewResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${smallProjectId}/video-html/preview`);
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.smallProjectId, smallProjectId);
    assert.equal(preview.htmlVideoProjectId, smallProjectId);
    assert.equal(preview.frames[0].previewUrl, `/preview/${smallProjectId}/frames/01-scene_001.html`);

    const frameResponse = await fetch(`http://127.0.0.1:${port}/preview/${smallProjectId}/frames/01-scene_001.html`);
    assert.equal(frameResponse.status, 200);
    assert.match(await frameResponse.text(), /Scene 1/);

    const traversalResponse = await fetch(`http://127.0.0.1:${port}/preview/${smallProjectId}/frames/..%2Fproject.json`);
    assert.equal(traversalResponse.status, 400);

    const missingResponse = await fetch(`http://127.0.0.1:${port}/preview/${smallProjectId}/frames/missing.html`);
    assert.equal(missingResponse.status, 404);
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
