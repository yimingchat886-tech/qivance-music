import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runWslCodexExec } from "../src/lib/wsl-codex-runner.ts";
import type { WslCodexDetection } from "../src/lib/wsl-codex-detect.ts";

test("runWslCodexExec writes prompt, JSONL, final, summary, and latest logs", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-codex-runner-"));
  await mkdir(path.join(projectPath, "hypeframes"), { recursive: true });
  const fakeWsl = path.join(projectPath, "wsl.exe");
  await writeFile(fakeWsl, [
    "#!/usr/bin/env bash",
    "cat >/dev/null",
    "echo '{\"type\":\"thread.started\",\"thread_id\":\"thread_123\"}'",
    "echo '{\"type\":\"item.completed\",\"item\":{\"type\":\"message\",\"text\":\"Codex final message\"}}'",
    "echo '{\"type\":\"turn.completed\"}'",
    "echo 'stderr note' >&2",
    "",
  ].join("\n"));
  await chmod(fakeWsl, 0o755);

  const detection: WslCodexDetection = {
    ok: true,
    mode: "wsl",
    wslExe: fakeWsl,
    distro: null,
    user: null,
    codexBinInput: "codex",
    codexPath: "/usr/local/bin/codex",
    version: "codex 1.2.3",
    execHelpOk: true,
    checked: [],
    projectPathHost: projectPath,
    projectPathWsl: "/mnt/c/qivance/project",
    hypeframesPathWsl: "/mnt/c/qivance/project/hypeframes",
    created_at: new Date().toISOString(),
  };

  const result = await runWslCodexExec({
    projectPath,
    cwdRelativePath: "hypeframes",
    prompt: "Refine the composition.",
    runId: "run_test",
    detection,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(await readFile(path.join(projectPath, result.logPaths.prompt), "utf8"), "Refine the composition.");
  assert.match(await readFile(path.join(projectPath, result.logPaths.stdoutJsonl), "utf8"), /thread_123/);
  assert.equal(await readFile(path.join(projectPath, result.logPaths.finalMessage), "utf8"), "Codex final message\n");
  const summary = JSON.parse(await readFile(path.join(projectPath, result.logPaths.summary), "utf8"));
  assert.equal(summary.thread_id, "thread_123");
  assert.equal(summary.status, "succeeded");
  assert.equal(await readFile(path.join(projectPath, "logs", "codex", "latest.final.md"), "utf8"), "Codex final message\n");
});
