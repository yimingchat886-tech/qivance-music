import assert from "node:assert/strict";
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
