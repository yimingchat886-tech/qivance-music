import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { ensureDir, writeJson } from "./fs-utils.ts";

export type HyperframesUiRuntimeStatus = "starting" | "retrying" | "running" | "stopped" | "failed";

type HyperframesUiRuntimeRecord = {
  project_id: string;
  status: HyperframesUiRuntimeStatus;
  pid: number | null;
  port: number;
  host: string;
  url: string;
  started_at: string | null;
  updated_at: string;
  attempt: number;
  last_error: string | null;
};

export type HyperframesUiRuntime = HyperframesUiRuntimeRecord & {
  status: "running";
  pid: number;
  started_at: string;
};

export type HyperframesUiStatus =
  | HyperframesUiRuntime
  | (HyperframesUiRuntimeRecord & { status: "starting" | "retrying" | "failed"; pid: null })
  | (HyperframesUiRuntimeRecord & { status: "stopped"; pid: number; started_at: string })
  | { status: "not_started"; url: null; attempt: 0; last_error: null; updated_at: null };

export type HyperframesCommand = {
  executable: string;
  prefixArgs: string[];
};

type SpawnPreview = (
  executable: string,
  args: string[],
  options: { cwd: string },
) => { pid?: number };

export function buildHyperframesStudioUrl(input: {
  requestHost?: string;
  port: number;
  projectName?: string;
}): string {
  const host = hostWithoutPort(input.requestHost ?? "127.0.0.1");
  return `http://${host}:${input.port}/#project/${encodeURIComponent(input.projectName ?? "hypeframes")}`;
}

export async function loadHyperframesUiStatus(
  projectPath: string,
  isProcessAlive = processAlive,
): Promise<HyperframesUiStatus> {
  const runtime = normalizeRuntimeRecord(await readOptionalJson<Partial<HyperframesUiRuntimeRecord>>(runtimePath(projectPath)));
  if (runtime === null) {
    return { status: "not_started", url: null, attempt: 0, last_error: null, updated_at: null };
  }
  if (runtime.status === "running") {
    return isProcessAlive(runtime.pid) ? runtime : { ...runtime, status: "stopped" };
  }
  return runtime as HyperframesUiStatus;
}

export async function startHyperframesUi(input: {
  projectPath: string;
  projectId: string;
  requestHost?: string;
  command?: HyperframesCommand;
  findFreePort?: () => Promise<number>;
  isProcessAlive?: (pid: number) => boolean;
  now?: () => string;
  spawnPreview?: SpawnPreview;
}): Promise<HyperframesUiRuntime> {
  const isProcessAlive = input.isProcessAlive ?? processAlive;
  const existing = await loadHyperframesUiStatus(input.projectPath, isProcessAlive);
  if (existing.status === "running") {
    return existing;
  }

  const hyperframesPath = path.join(input.projectPath, "hypeframes");
  if (await exists(path.join(hyperframesPath, "src", "index.html")) === false) {
    throw new Error("Missing HypeFrames project file hypeframes/src/index.html.");
  }

  const port = await (input.findFreePort ?? findFreePort)();
  const command = input.command ?? await findHyperframesCommand();
  const args = [...command.prefixArgs, "preview", "--port", String(port), "--no-open", "."];
  const url = buildHyperframesStudioUrl({ requestHost: input.requestHost, port, projectName: "hypeframes" });
  const now = input.now ?? (() => new Date().toISOString());
  const spawnPreview = input.spawnPreview ?? spawnDetached;
  const maxAttempts = 2;

  await persistRuntimeRecord(input.projectPath, {
    project_id: input.projectId,
    status: "starting",
    pid: null,
    port,
    host: "0.0.0.0",
    url,
    started_at: null,
    updated_at: now(),
    attempt: 1,
    last_error: null,
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const child = spawnPreview(command.executable, args, { cwd: hyperframesPath });
      if (child.pid === undefined) {
        throw new Error("HyperFrames preview process did not expose a pid.");
      }

      const runtime: HyperframesUiRuntime = {
        project_id: input.projectId,
        status: "running",
        pid: child.pid,
        port,
        host: "0.0.0.0",
        url,
        started_at: now(),
        updated_at: now(),
        attempt,
        last_error: null,
      };
      await persistRuntimeRecord(input.projectPath, runtime);
      return runtime;
    } catch (error) {
      const message = errorMessage(error);
      if (attempt < maxAttempts) {
        await persistRuntimeRecord(input.projectPath, {
          project_id: input.projectId,
          status: "retrying",
          pid: null,
          port,
          host: "0.0.0.0",
          url,
          started_at: null,
          updated_at: now(),
          attempt,
          last_error: message,
        });
        continue;
      }

      await persistRuntimeRecord(input.projectPath, {
        project_id: input.projectId,
        status: "failed",
        pid: null,
        port,
        host: "0.0.0.0",
        url,
        started_at: null,
        updated_at: now(),
        attempt,
        last_error: message,
      });
      throw new Error(`HyperFrames UI startup failed after ${attempt} attempts: ${message}`);
    }
  }

  throw new Error("HyperFrames UI startup failed before launching the preview process.");
}

async function persistRuntimeRecord(projectPath: string, runtime: HyperframesUiRuntimeRecord): Promise<void> {
  await ensureDir(path.join(projectPath, "logs"));
  await writeJson(runtimePath(projectPath), runtime);
}

async function findHyperframesCommand(): Promise<HyperframesCommand> {
  if (typeof process.env.HYPERFRAMES_BIN === "string" && process.env.HYPERFRAMES_BIN.length > 0 && await exists(process.env.HYPERFRAMES_BIN)) {
    return { executable: process.env.HYPERFRAMES_BIN, prefixArgs: [] };
  }

  const globalCandidate = path.join(path.dirname(process.execPath), "hyperframes");
  if (await exists(globalCandidate)) {
    return { executable: globalCandidate, prefixArgs: [] };
  }

  const npxRoot = path.join(homedir(), ".npm", "_npx");
  try {
    const entries = await readdir(npxRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() === false) continue;
      const candidate = path.join(npxRoot, entry.name, "node_modules", ".bin", "hyperframes");
      if (await exists(candidate)) {
        return { executable: candidate, prefixArgs: [] };
      }
    }
  } catch {
    // Fall through to npx without installing from the network.
  }

  return { executable: "npx", prefixArgs: ["--no-install", "hyperframes"] };
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address) {
          resolve(address.port);
        } else {
          reject(new Error("Unable to allocate a free port."));
        }
      });
    });
  });
}

function spawnDetached(executable: string, args: string[], options: { cwd: string }): { pid?: number } {
  const child = spawn(executable, args, {
    cwd: options.cwd,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return { pid: child.pid };
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runtimePath(projectPath: string): string {
  return path.join(projectPath, "logs", "hyperframes_ui.json");
}

function normalizeRuntimeRecord(value: Partial<HyperframesUiRuntimeRecord> | null): HyperframesUiRuntimeRecord | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const status = runtimeStatus(value.status);
  const pid = typeof value.pid === "number" ? value.pid : null;
  const port = typeof value.port === "number" ? value.port : null;
  const url = typeof value.url === "string" ? value.url : null;
  if (status === null || port === null || url === null) {
    return null;
  }
  if ((status === "running" || status === "stopped") && pid === null) {
    return null;
  }
  const now = new Date().toISOString();
  return {
    project_id: typeof value.project_id === "string" ? value.project_id : "unknown",
    status,
    pid,
    port,
    host: typeof value.host === "string" ? value.host : "0.0.0.0",
    url,
    started_at: typeof value.started_at === "string" ? value.started_at : null,
    updated_at: typeof value.updated_at === "string" ? value.updated_at : now,
    attempt: typeof value.attempt === "number" && Number.isFinite(value.attempt) ? value.attempt : 1,
    last_error: typeof value.last_error === "string" ? value.last_error : null,
  };
}

function runtimeStatus(value: unknown): HyperframesUiRuntimeStatus | null {
  if (value === "starting" || value === "retrying" || value === "running" || value === "stopped" || value === "failed") {
    return value;
  }
  return null;
}

async function readOptionalJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hostWithoutPort(value: string): string {
  const host = value.split(",")[0].trim();
  if (host.startsWith("[") && host.includes("]")) {
    return host.slice(1, host.indexOf("]"));
  }
  const colonIndex = host.indexOf(":");
  return colonIndex === -1 ? host : host.slice(0, colonIndex);
}
