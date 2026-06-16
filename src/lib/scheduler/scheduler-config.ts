import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { writeJson } from "../fs-utils.ts";
import { isRecord, SCHEDULER_RESOURCES, type SchedulerConfig, type SchedulerResource, type ValidationResult } from "./scheduler-types.ts";

export function defaultSchedulerConfig(): SchedulerConfig {
  return {
    schema_version: 1,
    project_parallelism: 1,
    chain_parallelism_per_project: 1,
    resource_limits: {
      cpu_light: 2,
      cpu_heavy: 1,
      gpu_whisperx: 1,
      html_video_agent: 1,
      chromium_render: 1,
      ffmpeg: 1,
      image_generation: 1,
      filesystem_write: 2,
    },
    lock_stale_timeout_sec: 1800,
    default_priority: 50,
  };
}

export function schedulerRoot(storageRoot: string): string {
  return path.join(storageRoot, "scheduler");
}

export function schedulerConfigPath(storageRoot: string): string {
  return path.join(schedulerRoot(storageRoot), "scheduler_config.json");
}

export async function readSchedulerConfig(storageRoot: string): Promise<SchedulerConfig> {
  const filePath = schedulerConfigPath(storageRoot);
  if (!(await exists(filePath))) return defaultSchedulerConfig();
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  const config = normalizeSchedulerConfig(parsed);
  const validation = validateSchedulerConfig(config);
  if (!validation.ok) {
    throw new Error(`Invalid scheduler_config.json: ${validation.issues.join("; ")}`);
  }
  return config;
}

export async function writeSchedulerConfig(storageRoot: string, config: SchedulerConfig): Promise<void> {
  const validation = validateSchedulerConfig(config);
  if (!validation.ok) throw new Error(`Invalid scheduler config: ${validation.issues.join("; ")}`);
  await writeJson(schedulerConfigPath(storageRoot), config);
}

export function validateSchedulerConfig(config: SchedulerConfig): ValidationResult {
  const issues: string[] = [];
  if (config.schema_version !== 1) issues.push("schema_version must be 1");
  if (!Number.isInteger(config.project_parallelism) || config.project_parallelism < 1) {
    issues.push("project_parallelism must be a positive integer");
  }
  if (!Number.isInteger(config.chain_parallelism_per_project) || config.chain_parallelism_per_project < 1) {
    issues.push("chain_parallelism_per_project must be a positive integer");
  }
  if (!Number.isInteger(config.lock_stale_timeout_sec) || config.lock_stale_timeout_sec < 1) {
    issues.push("lock_stale_timeout_sec must be a positive integer");
  }
  if (!Number.isInteger(config.default_priority)) issues.push("default_priority must be an integer");
  for (const resource of SCHEDULER_RESOURCES) {
    const limit = config.resource_limits[resource];
    if (!Number.isInteger(limit) || limit < 1) issues.push(`resource_limits.${resource} must be a positive integer`);
  }
  for (const key of Object.keys(config.resource_limits)) {
    if (!SCHEDULER_RESOURCES.includes(key as SchedulerResource)) issues.push(`unknown resource limit ${key}`);
  }
  return { ok: issues.length === 0, issues };
}

function normalizeSchedulerConfig(value: unknown): SchedulerConfig {
  const defaults = defaultSchedulerConfig();
  if (!isRecord(value)) return defaults;
  const rawLimits = isRecord(value.resource_limits) ? value.resource_limits : {};
  const resourceLimits = { ...defaults.resource_limits };
  for (const resource of SCHEDULER_RESOURCES) {
    if (rawLimits[resource] !== undefined) resourceLimits[resource] = Number(rawLimits[resource]);
  }
  for (const key of Object.keys(rawLimits)) {
    if (!SCHEDULER_RESOURCES.includes(key as SchedulerResource)) {
      (resourceLimits as Record<string, number>)[key] = Number(rawLimits[key]);
    }
  }
  return {
    schema_version: value.schema_version === 1 ? 1 : defaults.schema_version,
    project_parallelism: value.project_parallelism === undefined ? defaults.project_parallelism : Number(value.project_parallelism),
    chain_parallelism_per_project:
      value.chain_parallelism_per_project === undefined
        ? defaults.chain_parallelism_per_project
        : Number(value.chain_parallelism_per_project),
    resource_limits: resourceLimits,
    lock_stale_timeout_sec: value.lock_stale_timeout_sec === undefined ? defaults.lock_stale_timeout_sec : Number(value.lock_stale_timeout_sec),
    default_priority: value.default_priority === undefined ? defaults.default_priority : Number(value.default_priority),
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
