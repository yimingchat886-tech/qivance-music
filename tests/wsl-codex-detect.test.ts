import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { detectWslCodexCli } from "../src/lib/wsl-codex-detect.ts";

test("detectWslCodexCli records a successful WSL Codex detection", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-wsl-codex-ok-"));
  const fakeWsl = await writeFakeWsl(projectPath, "ok");

  const detection = await detectWslCodexCli({
    projectPath,
    platform: "win32",
    env: {
      QIVANCE_WSL_EXE: fakeWsl,
      QIVANCE_WSL_DISTRO: "Ubuntu",
      QIVANCE_WSL_USER: "jym",
      QIVANCE_WSL_CODEX_BIN: "codex",
      QIVANCE_HYPEFRAMES_AGENT: "wsl_codex_optional",
    },
  });

  assert.equal(detection.ok, true);
  assert.equal(detection.mode, "wsl");
  assert.equal(detection.distro, "Ubuntu");
  assert.equal(detection.user, "jym");
  if (detection.ok) {
    assert.equal(detection.codexPath, "/usr/local/bin/codex");
    assert.equal(detection.version, "codex 1.2.3");
    assert.equal(detection.execHelpOk, true);
    assert.equal(detection.projectPathWsl, "/mnt/c/qivance/project");
  }
  const qa = JSON.parse(await readFile(path.join(projectPath, "qa", "hypeframes", "wsl_codex_availability_qa_report.json"), "utf8"));
  assert.equal(qa.status, "rule_pass");
});

test("detectWslCodexCli writes warning QA for optional unavailable Codex", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-wsl-codex-missing-"));
  const fakeWsl = await writeFakeWsl(projectPath, "missing-codex");

  const detection = await detectWslCodexCli({
    projectPath,
    platform: "win32",
    env: {
      QIVANCE_WSL_EXE: fakeWsl,
      QIVANCE_WSL_CODEX_BIN: "codex",
      QIVANCE_HYPEFRAMES_AGENT: "wsl_codex_optional",
    },
  });

  assert.equal(detection.ok, false);
  if (!detection.ok) {
    assert.match(detection.blocking_issues.join(" "), /not available/i);
  }
  const qa = JSON.parse(await readFile(path.join(projectPath, "qa", "hypeframes", "wsl_codex_availability_qa_report.json"), "utf8"));
  assert.equal(qa.status, "rule_pass_with_warnings");
  assert.match(qa.warnings.join(" "), /deterministic HypeFrames generator/);
});

test("detectWslCodexCli blocks required mode when Codex is unavailable", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-wsl-codex-required-"));
  const fakeWsl = await writeFakeWsl(projectPath, "missing-codex");

  const detection = await detectWslCodexCli({
    projectPath,
    platform: "win32",
    env: {
      QIVANCE_WSL_EXE: fakeWsl,
      QIVANCE_WSL_CODEX_BIN: "codex",
      QIVANCE_HYPEFRAMES_AGENT: "wsl_codex_required",
    },
  });

  assert.equal(detection.ok, false);
  const qa = JSON.parse(await readFile(path.join(projectPath, "qa", "hypeframes", "wsl_codex_availability_qa_report.json"), "utf8"));
  assert.equal(qa.status, "rule_fail_blocked");
  assert.match(qa.blocking_issues.join(" "), /wsl_codex_required/);
});

async function writeFakeWsl(projectPath: string, mode: "ok" | "missing-codex"): Promise<string> {
  const fakeWsl = path.join(projectPath, "wsl.exe");
  await writeFile(fakeWsl, [
    "#!/usr/bin/env bash",
    "if [[ \"$1\" == '--status' ]]; then echo 'Default Distribution: Ubuntu'; exit 0; fi",
    "if [[ \"$1\" == '--list' ]]; then echo 'Ubuntu Running'; exit 0; fi",
    "script=\"${@: -1}\"",
    "if [[ \"$script\" == *'wslpath -a'* ]]; then echo '/mnt/c/qivance/project'; exit 0; fi",
    mode === "ok"
      ? "if [[ \"$script\" == *'command -v'* ]]; then echo '/usr/local/bin/codex'; exit 0; fi"
      : "if [[ \"$script\" == *'command -v'* ]]; then echo 'missing codex' >&2; exit 127; fi",
    "if [[ \"$script\" == *'--version'* ]]; then echo 'codex 1.2.3'; exit 0; fi",
    "if [[ \"$script\" == *'exec --help'* ]]; then echo 'Usage: codex exec'; exit 0; fi",
    "echo \"unexpected: $script\" >&2",
    "exit 1",
    "",
  ].join("\n"));
  await chmod(fakeWsl, 0o755);
  return fakeWsl;
}
