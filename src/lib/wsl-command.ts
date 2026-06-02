import { spawn } from "node:child_process";
import { existsSync as nodeExistsSync } from "node:fs";
import { scrubSecrets } from "./gate-report.ts";

const WINDOWS_SYSTEM32_WSL_EXE = "/mnt/c/Windows/System32/wsl.exe";

export type WslCommandInput = {
  wslExe?: string;
  distro?: string | null;
  user?: string | null;
  script: string;
  timeoutMs?: number;
  stdin?: string;
  env?: NodeJS.ProcessEnv;
};

export type WslCommandResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  commandForLog: string;
};

export type ResolveWslExeInput = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  existsSync?: (candidate: string) => boolean;
};

export function resolveWslExe(input: ResolveWslExeInput = {}): string {
  const env = { ...process.env, ...(input.env ?? {}) };
  if (env.QIVANCE_WSL_EXE) return env.QIVANCE_WSL_EXE;

  const platform = input.platform ?? process.platform;
  const existsSync = input.existsSync ?? nodeExistsSync;
  if (platform !== "win32" && (env.WSL_DISTRO_NAME || env.WSL_INTEROP) && existsSync(WINDOWS_SYSTEM32_WSL_EXE)) {
    return WINDOWS_SYSTEM32_WSL_EXE;
  }

  return "wsl.exe";
}

export async function runWslCommand(input: WslCommandInput): Promise<WslCommandResult> {
  const env = { ...process.env, ...(input.env ?? {}) };
  const wslExe = input.wslExe ?? resolveWslExe({ env });
  const args = [
    ...(input.distro ? ["--distribution", input.distro] : []),
    ...(input.user ? ["--user", input.user] : []),
    "--",
    "bash",
    "-lc",
    input.script,
  ];
  const commandForLog = scrubCommand([wslExe, ...args].join(" "));

  return await new Promise((resolve) => {
    const child = spawn(wslExe, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let spawnError: Error | null = null;
    const timeout = input.timeoutMs
      ? setTimeout(() => child.kill("SIGTERM"), input.timeoutMs)
      : null;

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", (exitCode, signal) => {
      if (timeout) clearTimeout(timeout);
      if (settled) return;
      settled = true;
      const stderrText = Buffer.concat(stderr).toString("utf8");
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: spawnError ? `${spawnError.message}${stderrText ? `\n${stderrText}` : ""}` : stderrText,
        commandForLog,
      });
    });

    if (input.stdin) {
      child.stdin.end(input.stdin);
    } else {
      child.stdin.end();
    }
  });
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function scrubCommand(command: string): string {
  return JSON.stringify(scrubSecrets({ command })).slice("{\"command\":\"".length, -2);
}
