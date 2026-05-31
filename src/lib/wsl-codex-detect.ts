import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { writeJson } from "./fs-utils.ts";
import { writeQaReport } from "./gate-report.ts";
import { toWslPath } from "./wsl-path.ts";
import { runWslCommand, shellQuote } from "./wsl-command.ts";

const execFileAsync = promisify(execFile);

export type WslCodexDetection =
  | {
      ok: true;
      mode: "wsl";
      wslExe: string;
      distro: string | null;
      user: string | null;
      codexBinInput: string;
      codexPath: string;
      version: string | null;
      execHelpOk: boolean;
      checked: WslCodexCheck[];
      projectPathHost: string;
      projectPathWsl: string;
      hypeframesPathWsl: string;
      created_at: string;
    }
  | {
      ok: false;
      mode: "wsl";
      wslExe: string;
      distro: string | null;
      user: string | null;
      codexBinInput: string;
      checked: WslCodexCheck[];
      blocking_issues: string[];
      install_hint: string;
      created_at: string;
    };

export type WslCodexCheck = {
  step: string;
  command: string;
  status: "ok" | "failed" | "skipped";
  stdout?: string;
  stderr?: string;
  error?: string;
};

export async function detectWslCodexCli(input: {
  projectPath: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<WslCodexDetection> {
  const env = { ...process.env, ...(input.env ?? {}) };
  const wslExe = env.QIVANCE_WSL_EXE ?? "wsl.exe";
  const distro = env.QIVANCE_WSL_DISTRO || null;
  const user = env.QIVANCE_WSL_USER || null;
  const codexBinInput = env.QIVANCE_WSL_CODEX_BIN ?? "codex";
  const checked: WslCodexCheck[] = [];
  const created_at = new Date().toISOString();

  await pushRawCheck(checked, "wsl_status", wslExe, ["--status"], env);
  await pushRawCheck(checked, "wsl_list", wslExe, ["--list", "--verbose"], env);

  let projectPathWsl: string | null = null;
  try {
    projectPathWsl = await toWslPath({
      absolutePath: input.projectPath,
      distro,
      user,
      wslExe,
      platform: input.platform,
    });
    checked.push({
      step: "project_path_wsl",
      command: "wslpath/realpath project path",
      status: "ok",
      stdout: projectPathWsl,
    });
  } catch (error) {
    checked.push({
      step: "project_path_wsl",
      command: "wslpath/realpath project path",
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const commandCheck = await runWslCommand({
    wslExe,
    distro,
    user,
    script: `command -v ${shellQuote(codexBinInput)}`,
    timeoutMs: 10_000,
    env,
  });
  checked.push(checkFromResult("command_v_codex", commandCheck.commandForLog, commandCheck));
  const codexPath = commandCheck.stdout.trim().split("\n")[0] ?? "";
  const shimIssue = codexPath && isWindowsCodexShim(codexPath)
    ? [`WSL Codex CLI resolved to a forbidden Windows host shim: ${codexPath}`]
    : [];

  let version: string | null = null;
  let execHelpOk = false;
  if (commandCheck.exitCode === 0 && codexPath && shimIssue.length === 0) {
    const versionCheck = await runWslCommand({
      wslExe,
      distro,
      user,
      script: `${shellQuote(codexPath)} --version`,
      timeoutMs: 10_000,
      env,
    });
    checked.push(checkFromResult("codex_version", versionCheck.commandForLog, versionCheck));
    version = versionCheck.exitCode === 0 ? versionCheck.stdout.trim() || null : null;

    const helpCheck = await runWslCommand({
      wslExe,
      distro,
      user,
      script: `${shellQuote(codexPath)} exec --help`,
      timeoutMs: 10_000,
      env,
    });
    checked.push(checkFromResult("codex_exec_help", helpCheck.commandForLog, helpCheck));
    execHelpOk = helpCheck.exitCode === 0;
  } else {
    checked.push({ step: "codex_version", command: "codex --version", status: "skipped" });
    checked.push({ step: "codex_exec_help", command: "codex exec --help", status: "skipped" });
  }

  const ok = Boolean(projectPathWsl && commandCheck.exitCode === 0 && codexPath && execHelpOk && shimIssue.length === 0);
  const detection: WslCodexDetection = ok
    ? {
        ok: true,
        mode: "wsl",
        wslExe,
        distro,
        user,
        codexBinInput,
        codexPath,
        version,
        execHelpOk,
        checked,
        projectPathHost: input.projectPath,
        projectPathWsl: projectPathWsl!,
        hypeframesPathWsl: `${projectPathWsl!}/hypeframes`,
        created_at,
      }
    : {
        ok: false,
        mode: "wsl",
        wslExe,
        distro,
        user,
        codexBinInput,
        checked,
        blocking_issues: [
          ...shimIssue,
          ...(shimIssue.length === 0 ? ["WSL Codex CLI is not available."] : []),
        ],
        install_hint: "Install and authenticate Codex CLI inside WSL, then ensure QIVANCE_WSL_CODEX_BIN resolves there.",
        created_at,
      };

  await writeJson(path.join(input.projectPath, "logs", "codex", "wsl_codex_detection.json"), detection);
  await writeAvailabilityQa(input.projectPath, detection, env.QIVANCE_HYPEFRAMES_AGENT ?? "wsl_codex_optional");
  return detection;
}

async function pushRawCheck(
  checked: WslCodexCheck[],
  step: string,
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  try {
    const { stdout, stderr } = await execFileAsync(executable, args, {
      env,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    checked.push({
      step,
      command: [executable, ...args].join(" "),
      status: "ok",
      stdout: String(stdout),
      stderr: String(stderr),
    });
  } catch (error) {
    checked.push({
      step,
      command: [executable, ...args].join(" "),
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function checkFromResult(
  step: string,
  command: string,
  result: { exitCode: number | null; stdout: string; stderr: string },
): WslCodexCheck {
  return {
    step,
    command,
    status: result.exitCode === 0 ? "ok" : "failed",
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function writeAvailabilityQa(
  projectPath: string,
  detection: WslCodexDetection,
  mode: string,
): Promise<void> {
  if (detection.ok) {
    await writeQaReport(projectPath, "qa/hypeframes/wsl_codex_availability_qa_report.json", {
      gate_name: "WSL Codex CLI Availability",
      status: "rule_pass",
      input_artifacts: [],
      output_artifacts: ["logs/codex/wsl_codex_detection.json"],
      metadata: {
        codex_path: detection.codexPath,
        version: detection.version,
        project_path_host: detection.projectPathHost,
        project_path_wsl: detection.projectPathWsl,
        hypeframes_path_wsl: detection.hypeframesPathWsl,
      },
    });
    return;
  }

  const required = mode === "wsl_codex_required";
  await writeQaReport(projectPath, "qa/hypeframes/wsl_codex_availability_qa_report.json", {
    gate_name: "WSL Codex CLI Availability",
    status: required ? "rule_fail_blocked" : "rule_pass_with_warnings",
    blocking_issues: required
      ? ["QIVANCE_HYPEFRAMES_AGENT=wsl_codex_required but WSL Codex CLI is not available."]
      : [],
    warnings: required ? [] : ["WSL Codex CLI is not available; deterministic HypeFrames generator will be used."],
    input_artifacts: [],
    output_artifacts: ["logs/codex/wsl_codex_detection.json"],
    metadata: { install_hint: detection.install_hint },
  });
}

function isWindowsCodexShim(codexPath: string): boolean {
  const normalized = codexPath.toLowerCase().replaceAll("\\", "/");
  return normalized.startsWith("/mnt/c/") ||
    normalized.endsWith(".exe") ||
    normalized.endsWith(".cmd") ||
    normalized.endsWith(".ps1") ||
    normalized.includes("powershell");
}
