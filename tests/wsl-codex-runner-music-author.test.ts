import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runWslCodexExec } from "../src/lib/wsl-codex-runner.ts";
import type { WslCodexDetection } from "../src/lib/wsl-codex-detect.ts";

test("runWslCodexExec uses Codex exec flags for project-root music authoring", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-codex-runner-root-"));
  const fakeWsl = path.join(projectPath, "wsl.exe");
  await mkdir(path.join(projectPath, "logs", "codex"), { recursive: true });
  await writeFile(fakeWsl, [
    "#!/usr/bin/env bash",
    "cat >/dev/null",
    "echo '{\"type\":\"turn.completed\"}'",
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

  await runWslCodexExec({
    projectPath,
    cwdRelativePath: ".",
    prompt: "author",
    runId: "run_root",
    detection,
  });

  const summary = JSON.parse(await readFile(path.join(projectPath, "logs", "codex", "run_root.summary.json"), "utf8"));
  assert.match(summary.command_for_log, /--skip-git-repo-check/);
  assert.match(summary.command_for_log, /sandbox_workspace_write\.network_access=true/);
  assert.match(summary.command_for_log, /default_permissions/);
  assert.equal(summary.command_for_log.includes("-C '/mnt/c/qivance/project'"), true);
  assert.equal(summary.command_for_log.endsWith(" -"), false);
});
