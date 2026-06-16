import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { writeJson } from "../fs-utils.ts";
import { schedulerRoot } from "./scheduler-config.ts";
import { buildExecutionPlan, writeExecutionPlan } from "./execution-plan.ts";
import type { ExecutionPlan, ResourceLockFile, SchedulerConfig, SchedulerRunQueue, SchedulerRunRecord, SchedulerRunRequest, SchedulerTask } from "./scheduler-types.ts";

export function runQueuePath(storageRoot: string): string {
  return path.join(schedulerRoot(storageRoot), "run_queue.json");
}

export async function readRunQueue(storageRoot: string): Promise<SchedulerRunQueue> {
  const filePath = runQueuePath(storageRoot);
  if (!(await exists(filePath))) return { schema_version: 1, runs: [] };
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as SchedulerRunQueue;
  return { schema_version: 1, runs: Array.isArray(parsed.runs) ? parsed.runs : [] };
}

export async function writeRunQueue(storageRoot: string, queue: SchedulerRunQueue): Promise<void> {
  await writeJson(runQueuePath(storageRoot), { schema_version: 1, runs: queue.runs });
}

export async function createSchedulerRun(input: {
  storageRoot: string;
  request: SchedulerRunRequest;
  runId?: string;
  now?: string;
}): Promise<{ run: SchedulerRunRecord; plans: ExecutionPlan[]; queue: SchedulerRunQueue }> {
  const now = input.now ?? new Date().toISOString();
  const run: SchedulerRunRecord = {
    run_id: input.runId ?? `run_${now.replace(/[^0-9]/g, "_").replace(/_+$/g, "")}`,
    status: "running",
    project_ids: input.request.project_ids,
    chains: input.request.chains,
    mode: input.request.mode,
    priority: input.request.priority,
    created_at: now,
    updated_at: now,
  };
  const plans: ExecutionPlan[] = [];
  for (const projectId of input.request.project_ids) {
    const plan = await buildExecutionPlan({
      storageRoot: input.storageRoot,
      projectId,
      chains: input.request.chains,
      runId: run.run_id,
      mode: input.request.mode,
      priority: input.request.priority,
      diagnosticAllowed: input.request.diagnostic_allowed,
      now,
    });
    await writeExecutionPlan(input.storageRoot, plan);
    plans.push(plan);
  }
  const queue = await readRunQueue(input.storageRoot);
  const nextQueue = { schema_version: 1 as const, runs: [...queue.runs.filter((item) => item.run_id !== run.run_id), run] };
  await writeRunQueue(input.storageRoot, nextQueue);
  await writeJson(path.join(schedulerRoot(input.storageRoot), "project_runs", `${run.run_id}.json`), { schema_version: 1, run, plans });
  return { run, plans, queue: nextQueue };
}

export function selectReadyTasks(input: {
  plans: ExecutionPlan[];
  locks: ResourceLockFile;
  config: SchedulerConfig;
  limit?: number;
}): SchedulerTask[] {
  const activeProjects = new Set(input.plans.flatMap((plan) => plan.tasks.filter((task) => task.status === "running").map((task) => task.project_id)));
  const lockCounts = new Map<string, number>();
  for (const lock of input.locks.locks) lockCounts.set(lock.resource, (lockCounts.get(lock.resource) ?? 0) + 1);
  const ready = input.plans
    .flatMap((plan) => plan.tasks)
    .filter((task) => task.status === "ready")
    .filter((task) => resourcesAvailable(task, lockCounts, input.config))
    .filter((task) => activeProjects.has(task.project_id) || activeProjects.size < input.config.project_parallelism);

  const byProject = new Map<string, SchedulerTask[]>();
  for (const task of ready) {
    const bucket = byProject.get(task.project_id) ?? [];
    bucket.push(task);
    byProject.set(task.project_id, bucket);
  }
  for (const bucket of byProject.values()) bucket.sort((a, b) => b.priority - a.priority || a.task_id.localeCompare(b.task_id));

  const selected: SchedulerTask[] = [];
  const projectIds = [...byProject.keys()].sort();
  while (selected.length < (input.limit ?? Number.POSITIVE_INFINITY)) {
    let added = false;
    for (const projectId of projectIds) {
      const task = byProject.get(projectId)?.shift();
      if (!task) continue;
      selected.push(task);
      added = true;
      if (selected.length >= (input.limit ?? Number.POSITIVE_INFINITY)) break;
    }
    if (!added) break;
  }
  return selected;
}

function resourcesAvailable(task: SchedulerTask, lockCounts: Map<string, number>, config: SchedulerConfig): boolean {
  const required = [...new Set(task.resource_requirements)];
  return required.every((resource) => (lockCounts.get(resource) ?? 0) < config.resource_limits[resource]);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
