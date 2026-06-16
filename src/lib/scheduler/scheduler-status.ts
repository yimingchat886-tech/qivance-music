import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { schedulerRoot } from "./scheduler-config.ts";
import { readResourceLocks } from "./resource-locks.ts";
import { readRunQueue } from "./run-queue.ts";
import type { ExecutionPlan, ResourceLock } from "./scheduler-types.ts";

export type SchedulerStatusSummary = {
  schema_version: 1;
  overall_status: "idle" | "running";
  ready_task_count: number;
  running_task_count: number;
  blocked_task_count: number;
  active_projects: string[];
  active_chains: string[];
  resource_locks: ResourceLock[];
};

export async function readSchedulerStatus(storageRoot: string): Promise<SchedulerStatusSummary> {
  const queue = await readRunQueue(storageRoot);
  const locks = await readResourceLocks(storageRoot);
  const plans = await readProjectRunPlans(storageRoot, queue.runs.map((run) => run.run_id));
  const tasks = plans.flatMap((plan) => plan.tasks);
  const activeRuns = queue.runs.filter((run) => run.status === "running");
  return {
    schema_version: 1,
    overall_status: activeRuns.length > 0 ? "running" : "idle",
    ready_task_count: tasks.filter((task) => task.status === "ready").length,
    running_task_count: tasks.filter((task) => task.status === "running").length,
    blocked_task_count: tasks.filter((task) => task.status === "blocked").length,
    active_projects: [...new Set(activeRuns.flatMap((run) => run.project_ids))].sort(),
    active_chains: [...new Set(activeRuns.flatMap((run) => run.chains))].sort(),
    resource_locks: locks.locks,
  };
}

async function readProjectRunPlans(storageRoot: string, runIds: string[]): Promise<ExecutionPlan[]> {
  const plans: ExecutionPlan[] = [];
  for (const runId of runIds) {
    const filePath = path.join(schedulerRoot(storageRoot), "project_runs", `${runId}.json`);
    if (!(await exists(filePath))) continue;
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as { plans?: ExecutionPlan[] };
    if (Array.isArray(parsed.plans)) plans.push(...parsed.plans);
  }
  return plans;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
