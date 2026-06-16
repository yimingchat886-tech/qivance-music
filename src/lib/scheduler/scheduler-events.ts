import { appendFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "../fs-utils.ts";
import { schedulerRoot } from "./scheduler-config.ts";
import type { SchedulerEvent, SchedulerEventType } from "./scheduler-types.ts";

export type SchedulerEventInput = {
  runId: string;
  projectId?: string | null;
  chainId?: string | null;
  taskId?: string | null;
  eventType: SchedulerEventType;
  message: string;
  details?: Record<string, unknown>;
  now?: string;
};

export function createSchedulerEvent(input: SchedulerEventInput): SchedulerEvent {
  const createdAt = input.now ?? new Date().toISOString();
  return {
    schema_version: 1,
    event_id: stableEventId(input.runId, input.taskId ?? input.eventType, input.eventType, createdAt),
    run_id: input.runId,
    project_id: input.projectId ?? null,
    chain_id: input.chainId ?? null,
    task_id: input.taskId ?? null,
    event_type: input.eventType,
    message: input.message,
    created_at: createdAt,
    details: input.details ?? {},
  };
}

export async function appendSchedulerEvent(storageRoot: string, event: SchedulerEvent): Promise<void> {
  await appendJsonl(path.join(schedulerRoot(storageRoot), "scheduler_events.jsonl"), event);
}

export async function appendProjectTaskEvent(storageRoot: string, projectId: string, event: SchedulerEvent): Promise<void> {
  await appendJsonl(path.join(storageRoot, projectId, "data", "scheduler", "task_events.jsonl"), event);
}

async function appendJsonl(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function stableEventId(...parts: string[]): string {
  return parts
    .join("_")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}
