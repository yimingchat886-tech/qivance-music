import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { defaultSchedulerConfig } from "../src/lib/scheduler/scheduler-config.ts";
import {
  acquireResourceLocks,
  detectStaleResourceLocks,
  readResourceLocks,
  releaseResourceLocksForTask,
  writeResourceLocks,
} from "../src/lib/scheduler/resource-locks.ts";
import type { SchedulerTask } from "../src/lib/scheduler/scheduler-types.ts";

test("acquires and releases resource locks", async () => {
  const storageRoot = await mkdtemp(path.join("/tmp", "qivance-resource-locks-"));
  const task = taskFixture("task_001", ["ffmpeg", "filesystem_write"]);
  const result = await acquireResourceLocks({
    storageRoot,
    config: defaultSchedulerConfig(),
    task,
    now: new Date("2026-06-15T00:00:00.000Z"),
  });

  assert.equal(result.acquired, true);
  assert.equal((await readResourceLocks(storageRoot)).locks.length, 2);

  const released = await releaseResourceLocksForTask(storageRoot, "task_001");
  assert.equal(released.length, 2);
  assert.equal((await readResourceLocks(storageRoot)).locks.length, 0);
});

test("does not partially acquire unavailable multi-resource locks", async () => {
  const storageRoot = await mkdtemp(path.join("/tmp", "qivance-resource-locks-"));
  const config = defaultSchedulerConfig();
  await acquireResourceLocks({
    storageRoot,
    config,
    task: taskFixture("task_existing", ["ffmpeg"]),
    now: new Date("2026-06-15T00:00:00.000Z"),
  });

  const result = await acquireResourceLocks({
    storageRoot,
    config,
    task: taskFixture("task_waiting", ["ffmpeg", "filesystem_write"]),
    now: new Date("2026-06-15T00:00:01.000Z"),
  });

  assert.equal(result.acquired, false);
  assert.deepEqual(result.unavailable, ["ffmpeg"]);
  const locks = await readResourceLocks(storageRoot);
  assert.equal(locks.locks.length, 1);
  assert.equal(locks.locks[0]?.owner_task_id, "task_existing");
});

test("detects stale resource locks", async () => {
  const storageRoot = await mkdtemp(path.join("/tmp", "qivance-resource-locks-"));
  await writeResourceLocks(storageRoot, {
    schema_version: 1,
    locks: [
      {
        resource: "ffmpeg",
        owner_run_id: "run_001",
        owner_task_id: "task_001",
        project_id: "project_a",
        chain_id: "chat_dialogue_mv",
        started_at: "2026-06-15T00:00:00.000Z",
        stale_after: "2026-06-15T00:01:00.000Z",
      },
    ],
  });

  const stale = detectStaleResourceLocks(await readResourceLocks(storageRoot), new Date("2026-06-15T00:02:00.000Z"));

  assert.equal(stale.length, 1);
  assert.equal(stale[0]?.owner_task_id, "task_001");
});

function taskFixture(taskId: string, resources: SchedulerTask["resource_requirements"]): SchedulerTask {
  return {
    task_id: taskId,
    run_id: "run_001",
    project_id: "project_a",
    chain_id: "chat_dialogue_mv",
    stage: "render_visual",
    status: "ready",
    priority: 50,
    dependencies: [],
    resource_requirements: resources,
    input_paths: [],
    output_paths: [],
    input_hashes: {},
    output_hashes: {},
    diagnostic_allowed: false,
    retry_count: 0,
    last_error: null,
  };
}
