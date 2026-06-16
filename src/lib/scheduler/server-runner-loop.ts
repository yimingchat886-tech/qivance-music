import type { SchedulerRun, SchedulerTask } from "@prisma/client";
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

export type V5SchedulerTaskHandler = (input: V5SchedulerTaskHandlerInput) => Promise<void> | void;
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
      await handler({ prisma, run, task });
      await recordTaskOutputArtifacts(prisma, run, task);
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
): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
  const outputs = JSON.parse(task.outputArtifactsJson) as string[];
  for (const relativePath of outputs) {
    const absolutePath = path.join(project.projectRoot, relativePath);
    if (!(await isFile(absolutePath))) continue;
    await prisma.artifact.create({
      data: {
        id: createControlPlaneId("artifact"),
        projectId: task.projectId,
        chainId: task.chainId,
        kind: artifactKind(relativePath),
        path: relativePath,
        sha256: await sha256File(absolutePath),
        schemaVersion: null,
        status: "current",
        createdByRunId: run.id,
      },
    });
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

export async function startV5RunnerLoop(input: {
  prisma: QivancePrismaClient;
  handlers: Partial<V5SchedulerTaskHandlers>;
  intervalMs?: number;
}): Promise<{ stop(): void }> {
  await recoverV5SchedulerRuns(input.prisma);
  const interval = setInterval(() => {
    void runV5SchedulerOnce(input.prisma, input.handlers).catch(() => undefined);
  }, input.intervalMs ?? 1000);
  return {
    stop() {
      clearInterval(interval);
    },
  };
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
