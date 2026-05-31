import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir, writeJson } from "./fs-utils.ts";
import { detectWslCodexCli, type WslCodexDetection } from "./wsl-codex-detect.ts";
import { runWslCommand, shellQuote } from "./wsl-command.ts";

export async function runWslCodexExec(input: {
  projectPath: string;
  cwdRelativePath: string;
  prompt: string;
  runId?: string;
  model?: string;
  detection?: WslCodexDetection;
}): Promise<{
  runId: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  logPaths: {
    prompt: string;
    stdoutJsonl: string;
    stderr: string;
    finalMessage: string;
    summary: string;
    diffstat: string;
    changedFiles: string;
  };
}> {
  const detection = input.detection ?? await detectWslCodexCli({ projectPath: input.projectPath });
  if (!detection.ok) {
    throw new Error("Cannot run WSL Codex exec because WSL Codex CLI is unavailable.");
  }

  const runId = input.runId ?? `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const logDir = path.join(input.projectPath, "logs", "codex");
  await ensureDir(logDir);
  const logPaths = {
    prompt: `logs/codex/${runId}.prompt.md`,
    stdoutJsonl: `logs/codex/${runId}.stdout.jsonl`,
    stderr: `logs/codex/${runId}.stderr.log`,
    finalMessage: `logs/codex/${runId}.final.md`,
    summary: `logs/codex/${runId}.summary.json`,
    diffstat: `logs/codex/${runId}.diffstat.txt`,
    changedFiles: `logs/codex/${runId}.changed_files.json`,
  };
  await writeFile(path.join(input.projectPath, logPaths.prompt), input.prompt, "utf8");

  const cwdWsl = `${detection.projectPathWsl}/${input.cwdRelativePath.replaceAll("\\", "/")}`.replace(/\/+/g, "/");
  const modelArgs = input.model ? ` --model ${shellQuote(input.model)}` : "";
  const script = [
    `cd ${shellQuote(cwdWsl)}`,
    `exec ${shellQuote(detection.codexPath)} exec --json --sandbox workspace-write${modelArgs} -`,
  ].join(" && ");
  const result = await runWslCommand({
    wslExe: detection.wslExe,
    distro: detection.distro,
    user: detection.user,
    script,
    stdin: input.prompt,
    timeoutMs: 120_000,
  });
  await writeFile(path.join(input.projectPath, logPaths.stdoutJsonl), result.stdout, "utf8");
  await writeFile(path.join(input.projectPath, logPaths.stderr), result.stderr, "utf8");

  const parsed = parseCodexJsonl(result.stdout, result.exitCode);
  await writeFile(path.join(input.projectPath, logPaths.finalMessage), `${parsed.finalMessage}`.trimEnd() + "\n", "utf8");
  await writeJson(path.join(input.projectPath, logPaths.summary), {
    run_id: runId,
    status: parsed.status,
    thread_id: parsed.threadId,
    command_for_log: result.commandForLog,
    jsonl_parse_warnings: parsed.warnings,
    exit_code: result.exitCode,
    signal: result.signal,
    changed_files: parsed.changedFiles,
    created_at: new Date().toISOString(),
  });
  await writeFile(path.join(input.projectPath, logPaths.diffstat), "", "utf8");
  await writeJson(path.join(input.projectPath, logPaths.changedFiles), parsed.changedFiles);

  await copyLatest(input.projectPath, logPaths);
  return { runId, exitCode: result.exitCode, signal: result.signal, logPaths };
}

export async function updateLatestCodexDiffLogs(
  projectPath: string,
  runId: string,
  diffstat: string,
  changedFiles: string[],
): Promise<void> {
  const diffstatPath = `logs/codex/${runId}.diffstat.txt`;
  const changedFilesPath = `logs/codex/${runId}.changed_files.json`;
  await writeFile(path.join(projectPath, diffstatPath), diffstat, "utf8");
  await writeJson(path.join(projectPath, changedFilesPath), changedFiles);
  await copyFile(path.join(projectPath, diffstatPath), path.join(projectPath, "logs", "codex", "latest.diffstat.txt"));
  await copyFile(
    path.join(projectPath, changedFilesPath),
    path.join(projectPath, "logs", "codex", "latest.changed_files.json"),
  );
}

function parseCodexJsonl(stdout: string, exitCode: number | null): {
  status: "succeeded" | "failed";
  threadId: string | null;
  finalMessage: string;
  changedFiles: string[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const changedFiles = new Set<string>();
  let threadId: string | null = null;
  let finalMessage = "";
  let status: "succeeded" | "failed" = exitCode === 0 ? "succeeded" : "failed";

  for (const [index, line] of stdout.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === "thread.started") {
        threadId = stringValue(event.thread_id) ?? stringValue(event.threadId) ?? threadId;
      }
      if (event.type === "turn.failed" || event.type === "error") {
        status = "failed";
      }
      if (event.type === "turn.completed") {
        status = status === "failed" ? "failed" : "succeeded";
      }
      const item = event.item;
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        if (record.type === "message") {
          finalMessage = stringValue(record.text) ?? stringValue(record.content) ?? finalMessage;
        }
        for (const file of stringArray(record.changed_files)) {
          changedFiles.add(file);
        }
      }
      for (const file of stringArray(event.changed_files)) {
        changedFiles.add(file);
      }
    } catch (error) {
      warnings.push(`Failed to parse JSONL line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    status,
    threadId,
    finalMessage,
    changedFiles: [...changedFiles].sort(),
    warnings,
  };
}

async function copyLatest(
  projectPath: string,
  logPaths: {
    prompt: string;
    stdoutJsonl: string;
    stderr: string;
    finalMessage: string;
    summary: string;
    diffstat: string;
    changedFiles: string;
  },
): Promise<void> {
  const latest = {
    prompt: "logs/codex/latest.prompt.md",
    stdoutJsonl: "logs/codex/latest.stdout.jsonl",
    stderr: "logs/codex/latest.stderr.log",
    finalMessage: "logs/codex/latest.final.md",
    summary: "logs/codex/latest.summary.json",
    diffstat: "logs/codex/latest.diffstat.txt",
    changedFiles: "logs/codex/latest.changed_files.json",
  };
  for (const key of Object.keys(latest) as Array<keyof typeof latest>) {
    await copyFile(path.join(projectPath, logPaths[key]), path.join(projectPath, latest[key]));
  }
  await readFile(path.join(projectPath, latest.summary), "utf8");
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
