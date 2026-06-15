import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { writeJson } from "../src/lib/fs-utils.ts";
import { defaultSchedulerConfig } from "../src/lib/scheduler/scheduler-config.ts";
import { createSchedulerRun, readRunQueue, selectReadyTasks } from "../src/lib/scheduler/run-queue.ts";
import type { ExecutionPlan, ResourceLockFile } from "../src/lib/scheduler/scheduler-types.ts";

test("creates multi-project run queue and project run evidence", async () => {
  const storageRoot = await mkdtemp(path.join("/tmp", "qivance-run-queue-"));
  await writeProjectFixture(storageRoot, "project_a");
  await writeProjectFixture(storageRoot, "project_b");

  const result = await createSchedulerRun({
    storageRoot,
    runId: "run_queue_001",
    now: "2026-06-15T00:00:00.000Z",
    request: {
      project_ids: ["project_a", "project_b"],
      chains: ["chat_dialogue_mv"],
      mode: "production",
      priority: 50,
      diagnostic_allowed: false,
      resume: true,
    },
  });

  assert.equal(result.run.run_id, "run_queue_001");
  assert.equal(result.plans.length, 2);
  assert.deepEqual((await readRunQueue(storageRoot)).runs.map((run) => run.run_id), ["run_queue_001"]);
  const runEvidence = JSON.parse(await readFile(path.join(storageRoot, "scheduler", "project_runs", "run_queue_001.json"), "utf8"));
  assert.equal(runEvidence.plans.length, 2);
});

test("ready task selection rotates across projects and respects resource locks", () => {
  const config = defaultSchedulerConfig();
  config.project_parallelism = 2;
  config.resource_limits.ffmpeg = 1;
  const plans: ExecutionPlan[] = [
    planFixture("project_a", [
      taskFixture("task_a_1", "project_a", ["cpu_light"], 90),
      taskFixture("task_a_2", "project_a", ["cpu_light"], 80),
    ]),
    planFixture("project_b", [
      taskFixture("task_b_1", "project_b", ["cpu_light"], 10),
      taskFixture("task_b_ffmpeg", "project_b", ["ffmpeg"], 100),
    ]),
  ];
  const locks: ResourceLockFile = {
    schema_version: 1,
    locks: [
      {
        resource: "ffmpeg",
        owner_run_id: "run_existing",
        owner_task_id: "task_existing",
        project_id: "project_c",
        chain_id: "chat_dialogue_mv",
        started_at: "2026-06-15T00:00:00.000Z",
        stale_after: "2026-06-15T00:30:00.000Z",
      },
    ],
  };

  const selected = selectReadyTasks({ plans, locks, config, limit: 3 });

  assert.deepEqual(selected.map((task) => task.task_id), ["task_a_1", "task_b_1", "task_a_2"]);
  assert.equal(selected.some((task) => task.task_id === "task_b_ffmpeg"), false);
});

async function writeProjectFixture(storageRoot: string, projectId: string): Promise<void> {
  const projectRoot = path.join(storageRoot, projectId);
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "lyrics.md"), "问：hello?\n答：world\n", "utf8");
  await writeFile(path.join(projectRoot, "active_music_take.mp3"), "audio", "utf8");
  for (const artifactPath of [
    "data/timing/beat_grid.json",
    "data/timing/onset_events.json",
    "data/timing/energy_curve.json",
    "data/timing/lyric_word_timing.json",
    "data/timing/alignment_report.json",
    "data/timing/section_map.json",
  ]) {
    await writeJson(path.join(projectRoot, artifactPath), { schema_version: 1, path: artifactPath });
  }
}

function planFixture(projectId: string, tasks: ExecutionPlan["tasks"]): ExecutionPlan {
  return {
    schema_version: 1,
    run_id: "run_001",
    project_id: projectId,
    chains: ["chat_dialogue_mv"],
    mode: "production",
    artifact_snapshot: {},
    tasks,
    created_at: "2026-06-15T00:00:00.000Z",
    updated_at: "2026-06-15T00:00:00.000Z",
  };
}

function taskFixture(taskId: string, projectId: string, resources: ExecutionPlan["tasks"][number]["resource_requirements"], priority: number): ExecutionPlan["tasks"][number] {
  return {
    task_id: taskId,
    run_id: "run_001",
    project_id: projectId,
    chain_id: "chat_dialogue_mv",
    stage: "build_conversation_plan",
    status: "ready",
    priority,
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
