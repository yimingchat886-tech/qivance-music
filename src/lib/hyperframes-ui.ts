import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { ensureDir, writeJson } from "./fs-utils.ts";

export type HyperframesUiRuntime = {
  project_id: string;
  status: "running";
  pid: number;
  port: number;
  host: string;
  url: string;
  started_at: string;
};

export type HyperframesUiStatus =
  | HyperframesUiRuntime
  | (Omit<HyperframesUiRuntime, "status"> & { status: "stopped" })
  | { status: "not_started"; url: null };

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
  const runtime = await readOptionalJson<HyperframesUiRuntime>(runtimePath(projectPath));
  if (!runtime) {
    return { status: "not_started", url: null };
  }
  return isProcessAlive(runtime.pid) ? runtime : { ...runtime, status: "stopped" };
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
  if (!(await exists(path.join(hyperframesPath, "src", "index.html")))) {
    throw new Error("Missing HypeFrames project file hypeframes/src/index.html.");
  }

  const port = await (input.findFreePort ?? findFreePort)();
  const command = input.command ?? await findHyperframesCommand();
  const args = [...command.prefixArgs, "preview", "--port", String(port), "--no-open", "."];
  const child = (input.spawnPreview ?? spawnDetached)(command.executable, args, { cwd: hyperframesPath });
  if (!child.pid) {
    throw new Error("HyperFrames preview process did not expose a pid.");
  }

  const runtime: HyperframesUiRuntime = {
    project_id: input.projectId,
    status: "running",
    pid: child.pid,
    port,
    host: "0.0.0.0",
    url: buildHyperframesStudioUrl({ requestHost: input.requestHost, port, projectName: "hypeframes" }),
    started_at: (input.now ?? (() => new Date().toISOString()))(),
  };
  await ensureDir(path.join(input.projectPath, "logs"));
  await writeJson(runtimePath(input.projectPath), runtime);
  return runtime;
}

async function findHyperframesCommand(): Promise<HyperframesCommand> {
  if (process.env.HYPERFRAMES_BIN && await exists(process.env.HYPERFRAMES_BIN)) {
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
      if (!entry.isDirectory()) continue;
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

function hostWithoutPort(value: string): string {
  const host = value.split(",")[0].trim();
  if (host.startsWith("[") && host.includes("]")) {
    return host.slice(1, host.indexOf("]"));
  }
  const colonIndex = host.indexOf(":");
  return colonIndex === -1 ? host : host.slice(0, colonIndex);
}
