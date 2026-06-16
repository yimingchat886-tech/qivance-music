import type { SchedulerRun, SchedulerTask } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { QivancePrismaClient } from "../db/prisma-client.ts";

export type V5RunWithTasks = SchedulerRun & { tasks: SchedulerTask[] };

export async function readV5RunWithTasks(
  prisma: QivancePrismaClient,
  runId: string,
): Promise<V5RunWithTasks | null> {
  return prisma.schedulerRun.findUnique({
    where: { id: runId },
    include: { tasks: { orderBy: { id: "asc" } } },
  });
}

export async function appendV5SchedulerEvent(
  prisma: QivancePrismaClient,
  input: {
    runId?: string | null;
    taskId?: string | null;
    eventType: string;
    message: string;
    details?: Record<string, unknown>;
  },
) {
  return prisma.schedulerEvent.create({
    data: {
      id: `event_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      runId: input.runId ?? null,
      taskId: input.taskId ?? null,
      eventType: input.eventType,
      message: input.message,
      detailsJson: input.details ? JSON.stringify(input.details) : null,
    },
  });
}

export async function requestV5RunStop(
  prisma: QivancePrismaClient,
  input: { projectId: string; runId: string },
): Promise<{ stopped_task_count: number }> {
  const run = await prisma.schedulerRun.findUnique({
    where: { id: input.runId },
    include: { tasks: true },
  });
  if (!run || run.projectId !== input.projectId) throw new Error(`Missing V5 run: ${input.runId}`);
  if (run.status === "passed" || run.status === "failed" || run.status === "stopped") {
    return { stopped_task_count: 0 };
  }

  await prisma.schedulerRun.update({
    where: { id: run.id },
    data: {
      status: "stopping",
      stopRequested: true,
    },
  });
  const stopped = await prisma.schedulerTask.updateMany({
    where: {
      runId: run.id,
      status: "queued",
    },
    data: {
      status: "stopped",
      finishedAt: new Date(),
    },
  });
  await appendV5SchedulerEvent(prisma, {
    runId: run.id,
    eventType: "run_stop_requested",
    message: "V5 scheduler run stop requested.",
    details: { stopped_task_count: stopped.count },
  });
  await updateV5RunTerminalStatus(prisma, run.id);
  return { stopped_task_count: stopped.count };
}

export async function recoverV5SchedulerRuns(prisma: QivancePrismaClient): Promise<{ recovered_task_count: number }> {
  const runningTasks = await prisma.schedulerTask.findMany({
    where: { status: "running" },
  });
  for (const task of runningTasks) {
    await prisma.schedulerTask.update({
      where: { id: task.id },
      data: {
        status: "queued",
        startedAt: null,
        lastError: null,
      },
    });
  }
  await prisma.schedulerRun.updateMany({
    where: { status: "running" },
    data: { status: "queued" },
  });
  return { recovered_task_count: runningTasks.length };
}

export async function updateV5RunTerminalStatus(prisma: QivancePrismaClient, runId: string): Promise<string> {
  const run = await prisma.schedulerRun.findUnique({
    where: { id: runId },
    include: { tasks: true },
  });
  if (!run) throw new Error(`Missing V5 run: ${runId}`);
  if (run.tasks.some((task) => task.status === "failed")) {
    await writeRunProjectStatus(prisma, run, "failed");
    return "failed";
  }
  if (run.tasks.some((task) => task.status === "blocked")) {
    await writeRunProjectStatus(prisma, run, "blocked");
    return "blocked";
  }
  if (run.tasks.length > 0 && run.tasks.every((task) => task.status === "stopped" || task.status === "passed")) {
    const nextStatus = run.stopRequested && run.tasks.some((task) => task.status === "stopped") ? "stopped" : "passed";
    await writeRunProjectStatus(prisma, run, nextStatus);
    return nextStatus;
  }
  if (run.tasks.some((task) => task.status === "running")) {
    await writeRunProjectStatus(prisma, run, "running");
    return "running";
  }
  const nextStatus = run.stopRequested ? "stopping" : "queued";
  await writeRunProjectStatus(prisma, run, nextStatus);
  return nextStatus;
}

async function writeRunProjectStatus(
  prisma: QivancePrismaClient,
  run: SchedulerRun,
  status: string,
): Promise<void> {
  await prisma.schedulerRun.update({ where: { id: run.id }, data: { status } });
  await prisma.project.update({ where: { id: run.projectId }, data: { status } });
  await prisma.chain.updateMany({
    where: {
      projectId: run.projectId,
      chainId: "chat_dialogue_mv",
    },
    data: { status },
  });
}
