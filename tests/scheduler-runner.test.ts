import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { writeJson } from "../src/lib/fs-utils.ts";
import { createSchedulerRun } from "../src/lib/scheduler/run-queue.ts";
import { readResourceLocks } from "../src/lib/scheduler/resource-locks.ts";
import { runSchedulerOnce } from "../src/lib/scheduler/scheduler-runner.ts";
import type { SchedulerTaskHandler } from "../src/lib/scheduler/scheduler-runner.ts";

test("scheduler tick executes ready task, records hashes, writes events, and releases locks", async () => {
  const storageRoot = await mkdtemp(path.join("/tmp", "qivance-scheduler-runner-"));
  await writeProjectFixture(storageRoot, "project_a");
  await createSchedulerRun({
    storageRoot,
    runId: "run_tick_001",
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

  const passHandler: SchedulerTaskHandler = async ({ storageRoot: root, task }) => {
    const outputPath = path.join(root, task.project_id, "data/chains/chat_dialogue_mv/runner-output.txt");
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, "passed", "utf8");
    task.output_paths.push("data/chains/chat_dialogue_mv/runner-output.txt");
  };

  const result = await runSchedulerOnce({
    storageRoot,
    limit: 1,
    now: "2026-06-15T00:01:00.000Z",
    handlers: {
      resolve_project_inputs: passHandler,
      build_lyrics_line_map: passHandler,
    },
  });

  assert.equal(result.executed_task_count, 1);
  assert.equal(result.failed_task_count, 0);
  assert.equal((await readResourceLocks(storageRoot)).locks.length, 0);
  const runFile = JSON.parse(await readFile(path.join(storageRoot, "scheduler/project_runs/run_tick_001.json"), "utf8"));
  const task = runFile.plans[0].tasks.find((candidate: any) => candidate.status === "passed");
  assert.equal(task.status, "passed");
  assert.match(task.output_hashes["data/chains/chat_dialogue_mv/runner-output.txt"], /^[a-f0-9]{64}$/);
  const events = await readFile(path.join(storageRoot, "scheduler/scheduler_events.jsonl"), "utf8");
  assert.match(events, /task_started/);
  assert.match(events, /task_passed/);
  assert.match(events, /resource_lock_released/);
});

test("scheduler tick keeps unrelated project task moving when another project handler fails", async () => {
  const storageRoot = await mkdtemp(path.join("/tmp", "qivance-scheduler-runner-"));
  await writeProjectFixture(storageRoot, "project_a");
  await writeProjectFixture(storageRoot, "project_b");
  await createSchedulerRun({
    storageRoot,
    runId: "run_tick_002",
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

  const projectHandler: SchedulerTaskHandler = ({ task }) => {
    if (task.project_id === "project_a") throw new Error("fixture failure");
  };

  const result = await runSchedulerOnce({
    storageRoot,
    limit: 2,
    now: "2026-06-15T00:01:00.000Z",
    handlers: {
      resolve_project_inputs: projectHandler,
      build_lyrics_line_map: projectHandler,
    },
  });

  assert.equal(result.executed_task_count, 1);
  assert.equal(result.failed_task_count, 1);
  const runFile = JSON.parse(await readFile(path.join(storageRoot, "scheduler/project_runs/run_tick_002.json"), "utf8"));
  const projectATask = runFile.plans[0].tasks.find((candidate: any) => candidate.status === "failed");
  const projectBTask = runFile.plans[1].tasks.find((candidate: any) => candidate.status === "passed");
  assert.equal(projectATask.status, "failed");
  assert.equal(projectBTask.status, "passed");
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
