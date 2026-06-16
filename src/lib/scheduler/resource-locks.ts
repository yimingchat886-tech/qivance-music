import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { writeJson } from "../fs-utils.ts";
import { schedulerRoot } from "./scheduler-config.ts";
import type { ResourceLock, ResourceLockFile, SchedulerConfig, SchedulerResource, SchedulerTask } from "./scheduler-types.ts";

export type AcquireResourceLocksResult =
  | { acquired: true; locks: ResourceLock[] }
  | { acquired: false; unavailable: SchedulerResource[]; locks: ResourceLock[] };

export function resourceLocksPath(storageRoot: string): string {
  return path.join(schedulerRoot(storageRoot), "resource_locks.json");
}

export async function readResourceLocks(storageRoot: string): Promise<ResourceLockFile> {
  const filePath = resourceLocksPath(storageRoot);
  if (!(await exists(filePath))) return { schema_version: 1, locks: [] };
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as ResourceLockFile;
  return {
    schema_version: 1,
    locks: Array.isArray(parsed.locks) ? parsed.locks : [],
  };
}

export async function writeResourceLocks(storageRoot: string, lockFile: ResourceLockFile): Promise<void> {
  await writeJson(resourceLocksPath(storageRoot), { schema_version: 1, locks: lockFile.locks });
}

export async function acquireResourceLocks(input: {
  storageRoot: string;
  config: SchedulerConfig;
  task: SchedulerTask;
  now?: Date;
}): Promise<AcquireResourceLocksResult> {
  const now = input.now ?? new Date();
  const lockFile = await readResourceLocks(input.storageRoot);
  const required = unique(input.task.resource_requirements);
  const unavailable = required.filter((resource) => countLocks(lockFile.locks, resource) >= input.config.resource_limits[resource]);
  if (unavailable.length > 0) return { acquired: false, unavailable, locks: lockFile.locks };

  const staleAfter = new Date(now.getTime() + input.config.lock_stale_timeout_sec * 1000).toISOString();
  const newLocks = required.map((resource): ResourceLock => ({
    resource,
    owner_run_id: input.task.run_id,
    owner_task_id: input.task.task_id,
    project_id: input.task.project_id,
    chain_id: input.task.chain_id,
    started_at: now.toISOString(),
    stale_after: staleAfter,
  }));
  const next = { schema_version: 1 as const, locks: [...lockFile.locks, ...newLocks] };
  await writeResourceLocks(input.storageRoot, next);
  return { acquired: true, locks: next.locks };
}

export async function releaseResourceLocksForTask(storageRoot: string, taskId: string): Promise<ResourceLock[]> {
  const lockFile = await readResourceLocks(storageRoot);
  const released = lockFile.locks.filter((lock) => lock.owner_task_id === taskId);
  const kept = lockFile.locks.filter((lock) => lock.owner_task_id !== taskId);
  await writeResourceLocks(storageRoot, { schema_version: 1, locks: kept });
  return released;
}

export function detectStaleResourceLocks(lockFile: ResourceLockFile, now = new Date()): ResourceLock[] {
  return lockFile.locks.filter((lock) => Date.parse(lock.stale_after) <= now.getTime());
}

function countLocks(locks: ResourceLock[], resource: SchedulerResource): number {
  return locks.filter((lock) => lock.resource === resource).length;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
