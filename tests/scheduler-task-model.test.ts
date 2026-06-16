import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { writeJson } from "../src/lib/fs-utils.ts";
import { defaultSchedulerConfig, readSchedulerConfig, validateSchedulerConfig } from "../src/lib/scheduler/scheduler-config.ts";
import { parseSchedulerRunRequest, validateSchedulerTask, type SchedulerTask } from "../src/lib/scheduler/scheduler-types.ts";

test("scheduler config falls back to conservative defaults", async () => {
  const storageRoot = await mkdtemp(path.join("/tmp", "qivance-scheduler-config-"));
  const config = await readSchedulerConfig(storageRoot);

  assert.equal(config.project_parallelism, 1);
  assert.equal(config.chain_parallelism_per_project, 1);
  assert.equal(config.resource_limits.ffmpeg, 1);
  assert.equal(config.resource_limits.filesystem_write, 2);
});

test("scheduler config validates resource limits", () => {
  const config = defaultSchedulerConfig();
  config.resource_limits.ffmpeg = 0;
  (config.resource_limits as Record<string, number>).unknown_resource = 1;

  const validation = validateSchedulerConfig(config);

  assert.equal(validation.ok, false);
  assert.match(validation.issues.join("\n"), /ffmpeg/);
  assert.match(validation.issues.join("\n"), /unknown_resource/);
});

test("scheduler config reads user settings", async () => {
  const storageRoot = await mkdtemp(path.join("/tmp", "qivance-scheduler-config-"));
  await writeJson(path.join(storageRoot, "scheduler", "scheduler_config.json"), {
    schema_version: 1,
    project_parallelism: 2,
    chain_parallelism_per_project: 2,
    resource_limits: { ffmpeg: 3 },
    lock_stale_timeout_sec: 60,
    default_priority: 80,
  });

  const config = await readSchedulerConfig(storageRoot);

  assert.equal(config.project_parallelism, 2);
  assert.equal(config.chain_parallelism_per_project, 2);
  assert.equal(config.resource_limits.ffmpeg, 3);
  assert.equal(config.resource_limits.html_video_agent, 1);
  assert.equal(config.lock_stale_timeout_sec, 60);
});

test("validates scheduler task shape", () => {
  const task: SchedulerTask = {
    task_id: "task_001",
    run_id: "run_001",
    project_id: "project_001",
    chain_id: "chat_dialogue_mv",
    stage: "build_conversation_plan",
    status: "ready",
    priority: 50,
    dependencies: [],
    resource_requirements: ["cpu_light", "filesystem_write"],
    input_paths: ["lyrics.md"],
    output_paths: ["data/chains/chat_dialogue_mv/conversation_plan.json"],
    input_hashes: {},
    output_hashes: {},
    diagnostic_allowed: false,
    retry_count: 0,
    last_error: null,
  };

  assert.equal(validateSchedulerTask(task).ok, true);

  const invalid = { ...task, task_id: "", resource_requirements: ["bad"] as any };
  const validation = validateSchedulerTask(invalid);
  assert.equal(validation.ok, false);
  assert.match(validation.issues.join("\n"), /task_id/);
  assert.match(validation.issues.join("\n"), /unknown resource/);
});

test("parses scheduler run request with safe defaults", () => {
  const parsed = parseSchedulerRunRequest({
    project_ids: ["a"],
    chains: ["chat_dialogue_mv"],
  });

  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.request?.mode, "production");
  assert.equal(parsed.request?.priority, 50);
  assert.equal(parsed.request?.resume, true);

  const invalid = parseSchedulerRunRequest({ project_ids: [], chains: [] });
  assert.match(invalid.issues.join("\n"), /project_ids/);
  assert.match(invalid.issues.join("\n"), /chains/);
});
