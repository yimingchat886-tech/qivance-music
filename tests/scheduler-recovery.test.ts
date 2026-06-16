import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { writeJson } from "../src/lib/fs-utils.ts";
import { defaultSchedulerConfig } from "../src/lib/scheduler/scheduler-config.ts";
import { acquireResourceLocks, readResourceLocks } from "../src/lib/scheduler/resource-locks.ts";
import { createSchedulerRun } from "../src/lib/scheduler/run-queue.ts";
import { cancelSchedulerRun, resumeSchedulerRun } from "../src/lib/scheduler/scheduler-runner.ts";
import { readSchedulerStatus } from "../src/lib/scheduler/scheduler-status.ts";

test("cancel marks non-terminal tasks and releases locks", async () => {
  const storageRoot = await mkdtemp(path.join("/tmp", "qivance-scheduler-recovery-"));
  await writeProjectFixture(storageRoot, "project_a");
  const created = await createSchedulerRun({
    storageRoot,
    runId: "run_cancel_001",
    now: "2026-06-15T00:00:00.000Z",
    request: {
      project_ids: ["project_a"],
      chains: ["chat_dialogue_mv"],
      mode: "production",
      priority: 50,
      diagnostic_allowed: false,
      resume: true,
    },
  });
  const runningTask = { ...created.plans[0]!.tasks.find((task) => task.status === "ready")!, status: "running" as const };
  created.plans[0]!.tasks[0] = runningTask;
  await writeJson(path.join(storageRoot, "scheduler", "project_runs", "run_cancel_001.json"), { schema_version: 1, run: created.run, plans: created.plans });
  await acquireResourceLocks({ storageRoot, config: defaultSchedulerConfig(), task: runningTask });

  const cancelled = await cancelSchedulerRun({ storageRoot, runId: "run_cancel_001", now: "2026-06-15T00:05:00.000Z" });

  assert.ok(cancelled.cancelledTasks.length > 0);
  assert.equal((await readResourceLocks(storageRoot)).locks.length, 0);
  const runFile = JSON.parse(await readFile(path.join(storageRoot, "scheduler", "project_runs", "run_cancel_001.json"), "utf8"));
  assert.equal(runFile.run.status, "cancelled");
  assert.ok(runFile.plans[0].tasks.some((task: any) => task.status === "cancelled"));
});

test("resume requeues running tasks without touching passed tasks", async () => {
  const storageRoot = await mkdtemp(path.join("/tmp", "qivance-scheduler-recovery-"));
  await writeProjectFixture(storageRoot, "project_b");
  const created = await createSchedulerRun({
    storageRoot,
    runId: "run_resume_001",
    now: "2026-06-15T00:00:00.000Z",
    request: {
      project_ids: ["project_b"],
      chains: ["chat_dialogue_mv"],
      mode: "production",
      priority: 50,
      diagnostic_allowed: false,
      resume: true,
    },
  });
  created.plans[0]!.tasks[0] = { ...created.plans[0]!.tasks[0]!, status: "passed" };
  created.plans[0]!.tasks[1] = { ...created.plans[0]!.tasks[1]!, status: "running" };
  await writeJson(path.join(storageRoot, "scheduler", "project_runs", "run_resume_001.json"), { schema_version: 1, run: created.run, plans: created.plans });
  await acquireResourceLocks({ storageRoot, config: defaultSchedulerConfig(), task: created.plans[0]!.tasks[1]! });

  const resumed = await resumeSchedulerRun({ storageRoot, runId: "run_resume_001", now: "2026-06-15T00:05:00.000Z" });

  assert.equal(resumed.requeuedTasks.length, 1);
  assert.equal((await readResourceLocks(storageRoot)).locks.length, 0);
  const runFile = JSON.parse(await readFile(path.join(storageRoot, "scheduler", "project_runs", "run_resume_001.json"), "utf8"));
  assert.equal(runFile.plans[0].tasks[0].status, "passed");
  assert.equal(runFile.plans[0].tasks[1].status, "ready");
});

test("scheduler status summarizes active runs and locks", async () => {
  const storageRoot = await mkdtemp(path.join("/tmp", "qivance-scheduler-recovery-"));
  await writeProjectFixture(storageRoot, "project_c");
  const created = await createSchedulerRun({
    storageRoot,
    runId: "run_status_001",
    now: "2026-06-15T00:00:00.000Z",
    request: {
      project_ids: ["project_c"],
      chains: ["chat_dialogue_mv"],
      mode: "production",
      priority: 50,
      diagnostic_allowed: false,
      resume: true,
    },
  });
  await acquireResourceLocks({ storageRoot, config: defaultSchedulerConfig(), task: created.plans[0]!.tasks.find((task) => task.resource_requirements.includes("ffmpeg"))! });

  const status = await readSchedulerStatus(storageRoot);

  assert.equal(status.overall_status, "running");
  assert.deepEqual(status.active_projects, ["project_c"]);
  assert.deepEqual(status.active_chains, ["chat_dialogue_mv"]);
  assert.equal(status.resource_locks.length > 0, true);
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
