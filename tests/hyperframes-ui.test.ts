import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildHyperframesStudioUrl,
  loadHyperframesUiStatus,
  startHyperframesUi,
} from "../src/lib/hyperframes-ui.ts";

test("HyperFrames studio URL reuses the LAN request host with the preview port", () => {
  assert.equal(
    buildHyperframesStudioUrl({
      requestHost: "192.168.1.25:3000",
      port: 3999,
      projectName: "hypeframes",
    }),
    "http://192.168.1.25:3999/#project/hypeframes",
  );
});

test("HyperFrames UI startup persists runtime metadata and preview command", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-hyperframes-ui-"));
  await mkdir(path.join(projectPath, "hypeframes", "src"), { recursive: true });
  await writeFile(path.join(projectPath, "hypeframes", "src", "index.html"), "<!doctype html>", "utf8");
  const calls: Array<{ executable: string; args: string[]; cwd: string }> = [];

  const runtime = await startHyperframesUi({
    projectPath,
    projectId: "project_hf_test",
    requestHost: "192.168.1.25:3000",
    command: { executable: "/bin/hyperframes", prefixArgs: [] },
    findFreePort: async () => 3999,
    isProcessAlive: () => false,
    now: () => "2026-05-29T00:00:00.000Z",
    spawnPreview: (executable, args, options) => {
      calls.push({ executable, args, cwd: options.cwd });
      return { pid: 12345 };
    },
  });

  assert.equal(runtime.url, "http://192.168.1.25:3999/#project/hypeframes");
  assert.equal(runtime.pid, 12345);
  assert.deepEqual(calls, [
    {
      executable: "/bin/hyperframes",
      args: ["preview", "--port", "3999", "--no-open", "."],
      cwd: path.join(projectPath, "hypeframes"),
    },
  ]);

  const status = await loadHyperframesUiStatus(projectPath, () => true);
  assert.equal(status.status, "running");
  assert.equal(status.url, runtime.url);

  const persisted = JSON.parse(await readFile(path.join(projectPath, "logs", "hyperframes_ui.json"), "utf8"));
  assert.equal(persisted.project_id, "project_hf_test");
  assert.equal(persisted.port, 3999);
});

test("HyperFrames UI startup records retry status when the first launch fails", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-hyperframes-ui-retry-"));
  await mkdir(path.join(projectPath, "hypeframes", "src"), { recursive: true });
  await writeFile(path.join(projectPath, "hypeframes", "src", "index.html"), "<html></html>", "utf8");
  const calls: string[] = [];

  const runtime = await startHyperframesUi({
    projectPath,
    projectId: "project_hf_retry",
    requestHost: "192.168.1.25:3000",
    command: { executable: "/bin/hyperframes", prefixArgs: [] },
    findFreePort: async () => 3999,
    isProcessAlive: () => false,
    now: () => "2026-06-02T00:00:00.000Z",
    spawnPreview: () => {
      calls.push("spawn");
      if (calls.length === 1) {
        throw new Error("first launch failed");
      }
      const retrying = JSON.parse(readFileSync(path.join(projectPath, "logs", "hyperframes_ui.json"), "utf8"));
      assert.equal(retrying.status, "retrying");
      assert.equal(retrying.attempt, 1);
      assert.match(retrying.last_error, /first launch failed/);
      return { pid: 12346 };
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(runtime.status, "running");
  assert.equal(runtime.attempt, 2);

  const persisted = JSON.parse(await readFile(path.join(projectPath, "logs", "hyperframes_ui.json"), "utf8"));
  assert.equal(persisted.status, "running");
  assert.equal(persisted.attempt, 2);
  assert.equal(persisted.last_error, null);
});

test("HyperFrames UI startup persists a failed status after retry exhaustion", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-hyperframes-ui-failed-"));
  await mkdir(path.join(projectPath, "hypeframes", "src"), { recursive: true });
  await writeFile(path.join(projectPath, "hypeframes", "src", "index.html"), "<html></html>", "utf8");

  await assert.rejects(
    startHyperframesUi({
      projectPath,
      projectId: "project_hf_failed",
      command: { executable: "/bin/hyperframes", prefixArgs: [] },
      findFreePort: async () => 3999,
      isProcessAlive: () => false,
      now: () => "2026-06-02T00:00:00.000Z",
      spawnPreview: () => {
        throw new Error("preview process failed");
      },
    }),
    /preview process failed/,
  );

  const persisted = JSON.parse(await readFile(path.join(projectPath, "logs", "hyperframes_ui.json"), "utf8"));
  assert.equal(persisted.status, "failed");
  assert.equal(persisted.attempt, 2);
  assert.match(persisted.last_error, /preview process failed/);
});
