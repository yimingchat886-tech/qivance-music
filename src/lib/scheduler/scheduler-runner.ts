import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { sha256File, writeJson } from "../fs-utils.ts";
import { markRunnableTasks } from "./execution-plan.ts";
import { createSchedulerEvent, appendProjectTaskEvent, appendSchedulerEvent } from "./scheduler-events.ts";
import { acquireResourceLocks, readResourceLocks, releaseResourceLocksForTask } from "./resource-locks.ts";
import { readRunQueue, selectReadyTasks, writeRunQueue } from "./run-queue.ts";
import { readSchedulerConfig, schedulerRoot } from "./scheduler-config.ts";
import { isTerminalTaskStatus, type ExecutionPlan, type SchedulerConfig, type SchedulerRunRecord, type SchedulerTask, type SchedulerTaskStage } from "./scheduler-types.ts";

export type SchedulerTaskHandlerInput = {
  storageRoot: string;
  run: SchedulerRunRecord;
  plan: ExecutionPlan;
  task: SchedulerTask;
};

export type SchedulerTaskHandler = (input: SchedulerTaskHandlerInput) => Promise<void> | void;
export type SchedulerTaskHandlers = Partial<Record<SchedulerTaskStage, SchedulerTaskHandler>>;

export type SchedulerRunTickResult = {
  selected_task_count: number;
  executed_task_count: number;
  failed_task_count: number;
  unavailable_task_count: number;
  completed_run_ids: string[];
  failed_run_ids: string[];
};

export async function cancelSchedulerRun(input: {
  storageRoot: string;
  runId: string;
  now?: string;
}): Promise<{ cancelledTasks: SchedulerTask[] }> {
  const now = input.now ?? new Date().toISOString();
  const queue = await readRunQueue(input.storageRoot);
  const run = queue.runs.find((item) => item.run_id === input.runId);
  if (run && run.status !== "completed" && run.status !== "failed") {
    run.status = "cancelled";
    run.updated_at = now;
    await writeRunQueue(input.storageRoot, queue);
  }
  const runFile = path.join(schedulerRoot(input.storageRoot), "project_runs", `${input.runId}.json`);
  const parsed = JSON.parse(await readFile(runFile, "utf8")) as { plans: ExecutionPlan[] };
  const cancelledTasks: SchedulerTask[] = [];
  const plans = parsed.plans.map((plan) => ({
    ...plan,
    tasks: plan.tasks.map((task) => {
      if (task.status === "passed" || task.status === "failed" || task.status === "cancelled" || task.status === "skipped" || task.status === "diagnostic_only") {
        return task;
      }
      cancelledTasks.push(task);
      return { ...task, status: "cancelled" as const };
    }),
    updated_at: now,
  }));
  for (const task of cancelledTasks) await releaseResourceLocksForTask(input.storageRoot, task.task_id);
  await writeJson(runFile, { schema_version: 1, run, plans });
  await appendSchedulerEvent(
    input.storageRoot,
    createSchedulerEvent({
      runId: input.runId,
      eventType: "run_cancelled",
      message: "Scheduler run cancelled.",
      now,
      details: { cancelled_task_count: cancelledTasks.length },
    }),
  );
  return { cancelledTasks };
}

export async function resumeSchedulerRun(input: {
  storageRoot: string;
  runId: string;
  now?: string;
}): Promise<{ requeuedTasks: SchedulerTask[] }> {
  const now = input.now ?? new Date().toISOString();
  const runFile = path.join(schedulerRoot(input.storageRoot), "project_runs", `${input.runId}.json`);
  const parsed = JSON.parse(await readFile(runFile, "utf8")) as { plans: ExecutionPlan[] };
  const requeuedTasks: SchedulerTask[] = [];
  const plans = parsed.plans.map((plan) => ({
    ...plan,
    tasks: plan.tasks.map((task) => {
      if (task.status !== "running") return task;
      requeuedTasks.push(task);
      return { ...task, status: "ready" as const };
    }),
    updated_at: now,
  }));
  for (const task of requeuedTasks) await releaseResourceLocksForTask(input.storageRoot, task.task_id);
  await writeJson(runFile, { ...parsed, plans });
  return { requeuedTasks };
}

export async function runSchedulerOnce(input: {
  storageRoot: string;
  handlers: SchedulerTaskHandlers;
  config?: SchedulerConfig;
  limit?: number;
  now?: string;
}): Promise<SchedulerRunTickResult> {
  const now = input.now ?? new Date().toISOString();
  const config = input.config ?? await readSchedulerConfig(input.storageRoot);
  const queue = await readRunQueue(input.storageRoot);
  const runFiles = await readActiveRunFiles(input.storageRoot, queue.runs);
  const plans = runFiles.flatMap((file) => file.data.plans);
  const selected = selectReadyTasks({
    plans,
    locks: await readResourceLocks(input.storageRoot),
    config,
    limit: input.limit,
  });
  const result: SchedulerRunTickResult = {
    selected_task_count: selected.length,
    executed_task_count: 0,
    failed_task_count: 0,
    unavailable_task_count: 0,
    completed_run_ids: [],
    failed_run_ids: [],
  };

  for (const selectedTask of selected) {
    const runFile = runFiles.find((file) => file.data.run.run_id === selectedTask.run_id);
    const plan = runFile?.data.plans.find((candidate) => candidate.project_id === selectedTask.project_id);
    const task = plan?.tasks.find((candidate) => candidate.task_id === selectedTask.task_id);
    if (!runFile || !plan || !task) continue;
    const handler = input.handlers[task.stage];
    const lockResult = await acquireResourceLocks({ storageRoot: input.storageRoot, config, task, now: new Date(now) });
    if (!lockResult.acquired) {
      result.unavailable_task_count += 1;
      await appendTaskEvent(input.storageRoot, task, "task_blocked", `Resources unavailable: ${lockResult.unavailable.join(", ")}`, now, { unavailable: lockResult.unavailable });
      continue;
    }

    task.status = "running";
    task.last_error = null;
    plan.updated_at = now;
    runFile.data.run.updated_at = now;
    await persistRunFile(input.storageRoot, runFile.data);
    await appendTaskEvent(input.storageRoot, task, "task_started", "Scheduler task started.", now);
    try {
      if (!handler) throw new Error(`No scheduler handler registered for ${task.stage}`);
      await handler({ storageRoot: input.storageRoot, run: runFile.data.run, plan, task });
      task.status = "passed";
      task.output_hashes = { ...task.output_hashes, ...await hashExistingOutputs(input.storageRoot, task) };
      result.executed_task_count += 1;
      await appendTaskEvent(input.storageRoot, task, "task_passed", "Scheduler task passed.", now);
    } catch (error) {
      task.status = "failed";
      task.last_error = error instanceof Error ? error.message : String(error);
      result.failed_task_count += 1;
      await appendTaskEvent(input.storageRoot, task, "task_failed", task.last_error, now);
    } finally {
      await releaseResourceLocksForTask(input.storageRoot, task.task_id);
      await appendTaskEvent(input.storageRoot, task, "resource_lock_released", "Scheduler task resource locks released.", now);
    }

    replacePlan(runFile.data, markRunnableTasks(plan));
    updateRunStatus(runFile.data, now);
    await persistRunFile(input.storageRoot, runFile.data);
  }

  for (const runFile of runFiles) {
    const queueRun = queue.runs.find((run) => run.run_id === runFile.data.run.run_id);
    if (!queueRun) continue;
    queueRun.status = runFile.data.run.status;
    queueRun.updated_at = runFile.data.run.updated_at;
    if (runFile.data.run.status === "completed") result.completed_run_ids.push(runFile.data.run.run_id);
    if (runFile.data.run.status === "failed") result.failed_run_ids.push(runFile.data.run.run_id);
  }
  await writeRunQueue(input.storageRoot, queue);
  return result;
}

type SchedulerProjectRunFile = {
  schema_version: 1;
  run: SchedulerRunRecord;
  plans: ExecutionPlan[];
};

async function readActiveRunFiles(storageRoot: string, runs: SchedulerRunRecord[]): Promise<Array<{ path: string; data: SchedulerProjectRunFile }>> {
  const files: Array<{ path: string; data: SchedulerProjectRunFile }> = [];
  for (const run of runs.filter((candidate) => candidate.status === "running")) {
    const filePath = path.join(schedulerRoot(storageRoot), "project_runs", `${run.run_id}.json`);
    const data = JSON.parse(await readFile(filePath, "utf8")) as SchedulerProjectRunFile;
    files.push({ path: filePath, data });
  }
  return files;
}

async function persistRunFile(storageRoot: string, data: SchedulerProjectRunFile): Promise<void> {
  await writeJson(path.join(schedulerRoot(storageRoot), "project_runs", `${data.run.run_id}.json`), data);
}

function replacePlan(data: SchedulerProjectRunFile, plan: ExecutionPlan): void {
  data.plans = data.plans.map((candidate) => candidate.project_id === plan.project_id ? plan : candidate);
}

function updateRunStatus(data: SchedulerProjectRunFile, now: string): void {
  const tasks = data.plans.flatMap((plan) => plan.tasks);
  const active = tasks.some((task) => task.status === "running" || task.status === "ready" || task.status === "planned");
  const blockedOnly = tasks.some((task) => task.status === "blocked") && !active;
  if (tasks.every((task) => isTerminalTaskStatus(task.status))) {
    data.run.status = tasks.some((task) => task.status === "failed") ? "failed" : "completed";
    data.run.updated_at = now;
    return;
  }
  if (blockedOnly && tasks.some((task) => task.status === "failed")) {
    data.run.status = "failed";
    data.run.updated_at = now;
    return;
  }
  data.run.status = "running";
  data.run.updated_at = now;
}

async function hashExistingOutputs(storageRoot: string, task: SchedulerTask): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const outputPath of task.output_paths) {
    if (outputPath.includes("<")) continue;
    const absolutePath = path.join(storageRoot, task.project_id, outputPath);
    if (!(await exists(absolutePath))) continue;
    hashes[outputPath] = await sha256File(absolutePath);
  }
  return hashes;
}

async function appendTaskEvent(
  storageRoot: string,
  task: SchedulerTask,
  eventType: Parameters<typeof createSchedulerEvent>[0]["eventType"],
  message: string,
  now: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const event = createSchedulerEvent({
    runId: task.run_id,
    projectId: task.project_id,
    chainId: task.chain_id,
    taskId: task.task_id,
    eventType,
    message,
    now,
    details,
  });
  await appendSchedulerEvent(storageRoot, event);
  await appendProjectTaskEvent(storageRoot, task.project_id, event);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
