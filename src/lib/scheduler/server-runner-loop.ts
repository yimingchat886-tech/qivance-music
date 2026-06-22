import type { Project, SchedulerRun, SchedulerTask } from "@prisma/client";
import { stat } from "node:fs/promises";
import path from "node:path";
import { createControlPlaneId } from "../db/control-plane.ts";
import type { QivancePrismaClient } from "../db/prisma-client.ts";
import { sha256File } from "../fs-utils.ts";
import { appendV5SchedulerEvent, recoverV5SchedulerRuns, updateV5RunTerminalStatus } from "./db-run-store.ts";

export type V5SchedulerTaskHandlerInput = {
  prisma: QivancePrismaClient;
  run: SchedulerRun;
  task: SchedulerTask;
};

export type V5OutputArtifactRef = {
  path: string;
  kind?: string;
  schemaVersion?: string | null;
  status?: string;
};

export type V5SchedulerTaskHandlerResult = void | {
  outputArtifacts?: V5OutputArtifactRef[];
};

export type V5SchedulerTaskHandler = (input: V5SchedulerTaskHandlerInput) => Promise<V5SchedulerTaskHandlerResult> | V5SchedulerTaskHandlerResult;
export type V5SchedulerTaskHandlers = Record<string, V5SchedulerTaskHandler>;

export type V5SchedulerOnceResult = {
  selected_task_count: number;
  executed_task_count: number;
  blocked_task_count: number;
  failed_task_count: number;
};

export async function runV5SchedulerOnce(
  prisma: QivancePrismaClient,
  handlers: Partial<V5SchedulerTaskHandlers>,
): Promise<V5SchedulerOnceResult> {
  const result: V5SchedulerOnceResult = {
    selected_task_count: 0,
    executed_task_count: 0,
    blocked_task_count: 0,
    failed_task_count: 0,
  };
  const runs = await prisma.schedulerRun.findMany({
    where: {
      status: { in: ["queued", "running"] },
      stopRequested: false,
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    include: { tasks: true },
  });

  for (const run of runs) {
    const task = nextReadyTask(run.tasks);
    if (!task) {
      await updateV5RunTerminalStatus(prisma, run.id);
      continue;
    }
    if (await stopQueuedTasksIfRequested(prisma, run.id)) {
      await updateV5RunTerminalStatus(prisma, run.id);
      continue;
    }
    result.selected_task_count += 1;
    const handler = handlers[task.stage];
    if (!handler) {
      await markTaskBlocked(prisma, run, task, `No V5 task handler registered for ${task.stage}`);
      result.blocked_task_count += 1;
      continue;
    }

    const claimed = await prisma.schedulerTask.updateMany({
      where: {
        id: task.id,
        status: "queued",
      },
      data: {
        status: "running",
        startedAt: new Date(),
        lastError: null,
      },
    });
    if (claimed.count !== 1) continue;
    await prisma.schedulerRun.update({ where: { id: run.id }, data: { status: "running" } });
    await appendV5SchedulerEvent(prisma, {
      runId: run.id,
      taskId: task.id,
      eventType: "task_started",
      message: `V5 task started: ${task.stage}`,
    });

    try {
      const handlerResult = await handler({ prisma, run, task });
      await recordTaskOutputArtifacts(prisma, run, task, handlerResult);
      await prisma.schedulerTask.update({
        where: { id: task.id },
        data: {
          status: "passed",
          finishedAt: new Date(),
        },
      });
      await appendV5SchedulerEvent(prisma, {
        runId: run.id,
        taskId: task.id,
        eventType: "task_passed",
        message: `V5 task passed: ${task.stage}`,
      });
      result.executed_task_count += 1;
      await stopQueuedTasksIfRequested(prisma, run.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const blocked = /^timing_blocked:/.test(message);
      await prisma.schedulerTask.update({
        where: { id: task.id },
        data: {
          status: blocked ? "blocked" : "failed",
          lastError: message,
          finishedAt: new Date(),
        },
      });
      await appendV5SchedulerEvent(prisma, {
        runId: run.id,
        taskId: task.id,
        eventType: blocked ? "task_blocked" : "task_failed",
        message,
      });
      if (blocked) result.blocked_task_count += 1;
      else result.failed_task_count += 1;
    }
    await updateV5RunTerminalStatus(prisma, run.id);
  }
  return result;
}

async function recordTaskOutputArtifacts(
  prisma: QivancePrismaClient,
  run: SchedulerRun,
  task: SchedulerTask,
  handlerResult: V5SchedulerTaskHandlerResult,
): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
  const declaredOutputs = parseDeclaredOutputArtifacts(task.outputArtifactsJson);
  const dynamicOutputs = declaredOutputs.filter((output) => output.dynamic);
  const returnedOutputs = outputArtifactsFromHandlerResult(handlerResult);

  for (const output of declaredOutputs.filter((candidate) => !candidate.dynamic)) {
    const exists = await createArtifactIfPresent(prisma, project, run, task, { path: output.path });
    if (!exists && output.required) {
      throw new Error(`artifact_missing: required output artifact is missing: ${output.path}`);
    }
  }

  if (dynamicOutputs.some((output) => output.required) && returnedOutputs.length === 0) {
    throw new Error("artifact_missing: required dynamic output artifact was not returned by handler.");
  }

  for (const output of returnedOutputs) {
    const exists = await createArtifactIfPresent(prisma, project, run, task, output);
    if (!exists) {
      throw new Error(`artifact_missing: returned output artifact is missing: ${output.path}`);
    }
  }
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function artifactKind(relativePath: string): string {
  return path.basename(relativePath).replace(/\.[^.]+$/, "");
}

type DeclaredOutputArtifact = {
  path: string;
  required: boolean;
  dynamic: boolean;
};

function parseDeclaredOutputArtifacts(value: string): DeclaredOutputArtifact[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("output_artifacts_invalid: expected an array.");
  return parsed.map((entry, index) => {
    if (typeof entry === "string") {
      const normalizedPath = normalizeProjectRelativePath(entry);
      return {
        path: normalizedPath,
        required: true,
        dynamic: hasDynamicPlaceholder(normalizedPath),
      };
    }
    if (isRecord(entry)) {
      const rawPath = stringField(entry, "path") ?? stringField(entry, "relativePath") ?? stringField(entry, "relative_path");
      if (!rawPath) throw new Error(`output_artifacts_invalid: entry ${index} is missing path.`);
      const normalizedPath = normalizeProjectRelativePath(rawPath);
      return {
        path: normalizedPath,
        required: entry.required !== false,
        dynamic: entry.dynamic === true || hasDynamicPlaceholder(normalizedPath),
      };
    }
    throw new Error(`output_artifacts_invalid: entry ${index} must be a string or object.`);
  });
}

function outputArtifactsFromHandlerResult(result: V5SchedulerTaskHandlerResult): V5OutputArtifactRef[] {
  if (!result || typeof result !== "object" || !Array.isArray(result.outputArtifacts)) return [];
  return result.outputArtifacts;
}

async function createArtifactIfPresent(
  prisma: QivancePrismaClient,
  project: Project,
  run: SchedulerRun,
  task: SchedulerTask,
  artifact: V5OutputArtifactRef,
): Promise<boolean> {
  const relativePath = normalizeProjectRelativePath(artifact.path);
  const absolutePath = path.join(project.projectRoot, relativePath);
  if (!(await isFile(absolutePath))) return false;
  await prisma.artifact.create({
    data: {
      id: createControlPlaneId("artifact"),
      projectId: task.projectId,
      chainId: task.chainId,
      kind: artifact.kind ?? artifactKind(relativePath),
      path: relativePath,
      sha256: await sha256File(absolutePath),
      schemaVersion: artifact.schemaVersion ?? null,
      status: artifact.status ?? "current",
      createdByRunId: run.id,
    },
  });
  return true;
}

function normalizeProjectRelativePath(value: string): string {
  const slashed = value.trim().replaceAll("\\", "/");
  const normalized = path.posix.normalize(slashed);
  if (
    !slashed
    || path.posix.isAbsolute(slashed)
    || normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || normalized.includes("/../")
  ) {
    throw new Error(`output_artifacts_invalid: output path must be project-relative: ${value}`);
  }
  return normalized;
}

function hasDynamicPlaceholder(relativePath: string): boolean {
  return /<[^/<>]+>/.test(relativePath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, field: string): string | null {
  return typeof value[field] === "string" ? value[field] : null;
}

async function stopQueuedTasksIfRequested(prisma: QivancePrismaClient, runId: string): Promise<boolean> {
  const run = await prisma.schedulerRun.findUnique({
    where: { id: runId },
    select: { stopRequested: true },
  });
  if (!run?.stopRequested) return false;
  const stopped = await prisma.schedulerTask.updateMany({
    where: {
      runId,
      status: "queued",
    },
    data: {
      status: "stopped",
      finishedAt: new Date(),
    },
  });
  if (stopped.count > 0) {
    await appendV5SchedulerEvent(prisma, {
      runId,
      eventType: "run_stop_enforced",
      message: "V5 scheduler stop request prevented queued tasks from starting.",
      details: { stopped_task_count: stopped.count },
    });
  }
  return true;
}

export async function startV5RunnerLoop(input: {
  prisma: QivancePrismaClient;
  handlers: Partial<V5SchedulerTaskHandlers>;
  intervalMs?: number;
}): Promise<{
  stop(options?: { drain?: boolean }): Promise<void>;
  isRunning(): boolean;
}> {
  await recoverV5SchedulerRuns(input.prisma);
  let stopped = false;
  let activeTick: Promise<void> | null = null;
  const runTick = () => {
    if (stopped || activeTick) return;
    activeTick = runV5SchedulerOnce(input.prisma, input.handlers)
      .then(() => undefined)
      .catch((error) => recordRunnerLoopError(input.prisma, error))
      .finally(() => {
        activeTick = null;
      });
  };
  const interval = setInterval(runTick, input.intervalMs ?? 1000);
  return {
    async stop(options: { drain?: boolean } = {}) {
      stopped = true;
      clearInterval(interval);
      if (options.drain && activeTick) await activeTick;
    },
    isRunning() {
      return activeTick !== null;
    },
  };
}

async function recordRunnerLoopError(prisma: QivancePrismaClient, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await appendV5SchedulerEvent(prisma, {
    eventType: "runner_loop_error",
    message,
    details: { stack: error instanceof Error ? error.stack : undefined },
  }).catch(() => undefined);
}

function nextReadyTask(tasks: SchedulerTask[]): SchedulerTask | null {
  const passed = new Set(tasks.filter((task) => task.status === "passed").map((task) => task.id));
  return [...tasks]
    .filter((task) => task.status === "queued")
    .sort((a, b) => a.id.localeCompare(b.id))
    .find((task) => JSON.parse(task.dependenciesJson).every((dependency: string) => passed.has(dependency)))
    ?? null;
}

async function markTaskBlocked(
  prisma: QivancePrismaClient,
  run: SchedulerRun,
  task: SchedulerTask,
  message: string,
): Promise<void> {
  await prisma.schedulerTask.update({
    where: { id: task.id },
    data: {
      status: "blocked",
      lastError: message,
      finishedAt: new Date(),
    },
  });
  await appendV5SchedulerEvent(prisma, {
    runId: run.id,
    taskId: task.id,
    eventType: "task_blocked",
    message,
  });
  await updateV5RunTerminalStatus(prisma, run.id);
}
