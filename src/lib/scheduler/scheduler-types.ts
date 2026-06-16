export const SCHEDULER_RESOURCES = [
  "cpu_light",
  "cpu_heavy",
  "gpu_whisperx",
  "html_video_agent",
  "chromium_render",
  "ffmpeg",
  "image_generation",
  "filesystem_write",
] as const;

export type SchedulerResource = (typeof SCHEDULER_RESOURCES)[number];

export const SCHEDULER_TASK_STATUSES = [
  "planned",
  "blocked",
  "ready",
  "running",
  "passed",
  "failed",
  "cancelled",
  "skipped",
  "diagnostic_only",
] as const;

export type SchedulerTaskStatus = (typeof SCHEDULER_TASK_STATUSES)[number];
export type SchedulerMode = "production" | "diagnostic";

export const SCHEDULER_TASK_STAGES = [
  "resolve_project_inputs",
  "resolve_timing_bundle",
  "run_timing_pipeline",
  "build_lyrics_line_map",
  "build_speaker_attribution",
  "build_conversation_plan",
  "build_chain_animation_plan",
  "build_chat_frame_contracts",
  "build_chat_frames",
  "validate_frames",
  "build_preview",
  "render_visual",
  "mux_audio",
  "run_media_qa",
  "write_render_manifest",
  "write_chain_status",
] as const;

export type SchedulerTaskStage = (typeof SCHEDULER_TASK_STAGES)[number] | `run_existing_chain_${string}`;

export const TERMINAL_TASK_STATUSES = [
  "passed",
  "failed",
  "cancelled",
  "skipped",
  "diagnostic_only",
] as const satisfies readonly SchedulerTaskStatus[];

export type SchedulerEventType =
  | "run_created"
  | "execution_plan_written"
  | "task_ready"
  | "task_blocked"
  | "task_started"
  | "task_passed"
  | "task_failed"
  | "task_skipped"
  | "task_cancelled"
  | "resource_lock_acquired"
  | "resource_lock_released"
  | "resource_lock_stale"
  | "run_completed"
  | "run_failed"
  | "run_cancelled";

export type SchedulerConfig = {
  schema_version: 1;
  project_parallelism: number;
  chain_parallelism_per_project: number;
  resource_limits: Record<SchedulerResource, number>;
  lock_stale_timeout_sec: number;
  default_priority: number;
};

export type ArtifactSnapshotEntry = {
  exists: boolean;
  path: string;
  sha256?: string;
  stale?: boolean;
};

export type SchedulerTask = {
  task_id: string;
  run_id: string;
  project_id: string;
  chain_id: string;
  stage: SchedulerTaskStage;
  status: SchedulerTaskStatus;
  priority: number;
  dependencies: string[];
  resource_requirements: SchedulerResource[];
  input_paths: string[];
  output_paths: string[];
  input_hashes: Record<string, string>;
  output_hashes: Record<string, string>;
  diagnostic_allowed: boolean;
  retry_count: number;
  last_error: string | null;
};

export type ExecutionPlan = {
  schema_version: 1;
  run_id: string;
  project_id: string;
  chains: string[];
  mode: SchedulerMode;
  artifact_snapshot: Record<string, ArtifactSnapshotEntry>;
  tasks: SchedulerTask[];
  created_at: string;
  updated_at: string;
};

export type SchedulerRunRecord = {
  run_id: string;
  status: "planned" | "running" | "completed" | "failed" | "cancelled";
  project_ids: string[];
  chains: string[];
  mode: SchedulerMode;
  priority: number;
  created_at: string;
  updated_at: string;
};

export type SchedulerRunQueue = {
  schema_version: 1;
  runs: SchedulerRunRecord[];
};

export type ResourceLock = {
  resource: SchedulerResource;
  owner_run_id: string;
  owner_task_id: string;
  project_id: string;
  chain_id: string;
  started_at: string;
  stale_after: string;
};

export type ResourceLockFile = {
  schema_version: 1;
  locks: ResourceLock[];
};

export type SchedulerEvent = {
  schema_version: 1;
  event_id: string;
  run_id: string;
  project_id: string | null;
  chain_id: string | null;
  task_id: string | null;
  event_type: SchedulerEventType;
  message: string;
  created_at: string;
  details: Record<string, unknown>;
};

export type ValidationResult = {
  ok: boolean;
  issues: string[];
};

export type SchedulerRunRequest = {
  project_ids: string[];
  chains: string[];
  mode: SchedulerMode;
  priority: number;
  diagnostic_allowed: boolean;
  resume: boolean;
};

export function isTerminalTaskStatus(status: SchedulerTaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(status as (typeof TERMINAL_TASK_STATUSES)[number]);
}

export function validateSchedulerTask(task: SchedulerTask): ValidationResult {
  const issues: string[] = [];
  if (typeof task.task_id !== "string" || task.task_id.length === 0) issues.push("task_id is required");
  if (typeof task.run_id !== "string" || task.run_id.length === 0) issues.push("run_id is required");
  if (typeof task.project_id !== "string" || task.project_id.length === 0) issues.push("project_id is required");
  if (typeof task.chain_id !== "string" || task.chain_id.length === 0) issues.push("chain_id is required");
  if (!SCHEDULER_TASK_STATUSES.includes(task.status)) issues.push(`unknown task status ${String(task.status)}`);
  for (const resource of task.resource_requirements) {
    if (!SCHEDULER_RESOURCES.includes(resource)) issues.push(`unknown resource ${String(resource)}`);
  }
  for (const dependency of task.dependencies) {
    if (typeof dependency !== "string" || dependency.length === 0) issues.push("dependencies must be non-empty strings");
  }
  if (!Number.isInteger(task.priority)) issues.push("priority must be an integer");
  if (!Number.isInteger(task.retry_count) || task.retry_count < 0) issues.push("retry_count must be a non-negative integer");
  return { ok: issues.length === 0, issues };
}

export function parseSchedulerRunRequest(value: unknown): { request?: SchedulerRunRequest; issues: string[] } {
  const issues: string[] = [];
  if (!isRecord(value)) return { issues: ["request body must be an object"] };

  const projectIds = parseStringArray(value.project_ids, "project_ids", issues);
  const chains = parseStringArray(value.chains, "chains", issues);
  const mode = value.mode === "diagnostic" ? "diagnostic" : value.mode === "production" || value.mode === undefined ? "production" : null;
  if (!mode) issues.push("mode must be production or diagnostic");
  const priority = value.priority === undefined ? 50 : Number(value.priority);
  if (!Number.isInteger(priority)) issues.push("priority must be an integer");
  const diagnosticAllowed = value.diagnostic_allowed === true;
  const resume = value.resume !== false;

  if (issues.length > 0 || !projectIds || !chains || !mode) return { issues };
  return {
    request: {
      project_ids: projectIds,
      chains,
      mode,
      priority,
      diagnostic_allowed: diagnosticAllowed,
      resume,
    },
    issues,
  };
}

export function stableTaskId(parts: string[]): string {
  return parts
    .join("_")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStringArray(value: unknown, field: string, issues: string[]): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`${field} must be a non-empty array`);
    return null;
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      issues.push(`${field} values must be non-empty strings`);
      return null;
    }
    result.push(item);
  }
  return result;
}
