import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeJson } from "../src/lib/fs-utils.ts";
import { defaultSchedulerConfig, schedulerRoot, writeSchedulerConfig } from "../src/lib/scheduler/scheduler-config.ts";
import { acquireResourceLocks, readResourceLocks, releaseResourceLocksForTask } from "../src/lib/scheduler/resource-locks.ts";
import { createSchedulerRun, selectReadyTasks } from "../src/lib/scheduler/run-queue.ts";
import { resumeSchedulerRun, runSchedulerOnce } from "../src/lib/scheduler/scheduler-runner.ts";
import type { ExecutionPlan, SchedulerTask } from "../src/lib/scheduler/scheduler-types.ts";

if (!process.argv.includes("--scheduler-smoke")) {
  console.error("usage: node --experimental-strip-types scripts/e2e-scheduler-v4.ts --scheduler-smoke [--storage-root <path>]");
  process.exit(2);
}

const storageRoot = path.resolve(argValue("--storage-root") ?? path.join("projects", `v4_scheduler_${stamp()}`));
const runId = `run_scheduler_v4_${stamp()}`;
const projectIds = ["scheduler_project_a", "scheduler_project_b"];
const chains = ["chat_dialogue_mv", "image_storyboard_mv"];
const config = {
  ...defaultSchedulerConfig(),
  project_parallelism: 2,
  chain_parallelism_per_project: 2,
  resource_limits: {
    ...defaultSchedulerConfig().resource_limits,
    chromium_render: 1,
    html_video_agent: 1,
    ffmpeg: 1,
  },
};

await mkdir(storageRoot, { recursive: true });
await writeSchedulerConfig(storageRoot, config);
for (const projectId of projectIds) await writeSchedulerFixtureProject(storageRoot, projectId);

const created = await createSchedulerRun({
  storageRoot,
  runId,
  request: {
    project_ids: projectIds,
    chains,
    mode: "production",
    priority: 70,
    diagnostic_allowed: false,
    resume: true,
  },
});

const timingWriters = created.plans.flatMap((plan) => plan.tasks.filter((task) => task.stage === "run_timing_pipeline"));
assertCondition(timingWriters.length === projectIds.length, "timing writer appears once per project");
assertCondition(timingWriters.every((task) => task.status === "skipped"), "existing timing bundle skips timing writer");

const initialSelection = selectReadyTasks({
  plans: created.plans,
  locks: { schema_version: 1, locks: [] },
  config,
  limit: 6,
});
const selectedProjects = new Set(initialSelection.map((task) => task.project_id));
assertCondition(projectIds.every((projectId) => selectedProjects.has(projectId)), "ready queue advances multiple projects fairly");
assertCondition(initialSelection.some((task) => task.chain_id === "chat_dialogue_mv"), "chat dialogue chain participates in scheduling");
assertCondition(initialSelection.some((task) => task.chain_id === "image_storyboard_mv"), "existing chain participates in scheduling");

const tickResult = await runSchedulerOnce({
  storageRoot,
  config,
  limit: 2,
  handlers: {
    resolve_project_inputs: () => undefined,
    build_lyrics_line_map: () => undefined,
    run_existing_chain_image_storyboard_mv: () => undefined,
  },
});
assertCondition(tickResult.executed_task_count === 2, "scheduler tick executes selected ready tasks");
assertCondition(tickResult.failed_task_count === 0, "scheduler tick does not fail lightweight handlers");

const renderTasks = created.plans.map((plan) => readyTask(plan, "render_visual"));
const firstRender = renderTasks[0]!;
const secondRender = renderTasks[1]!;
const lockResult = await acquireResourceLocks({ storageRoot, config, task: firstRender });
assertCondition(lockResult.acquired, "first chromium render lock is acquired");
const lockedSelection = selectReadyTasks({
  plans: [{ ...created.plans[1]!, tasks: [secondRender] }],
  locks: await readResourceLocks(storageRoot),
  config,
  limit: 2,
});
assertCondition(lockedSelection.length === 0, "resource lock prevents concurrent chromium render task");
await releaseResourceLocksForTask(storageRoot, firstRender.task_id);

const failedPlan = withTaskStatus(created.plans[0]!, initialSelection.find((task) => task.project_id === projectIds[0])!, "failed");
const isolatedSelection = selectReadyTasks({
  plans: [failedPlan, created.plans[1]!],
  locks: { schema_version: 1, locks: [] },
  config,
  limit: 4,
});
assertCondition(isolatedSelection.some((task) => task.project_id === projectIds[1]), "failed project task does not block unrelated project task");

const runFile = path.join(schedulerRoot(storageRoot), "project_runs", `${runId}.json`);
const persisted = await readJson<{ schema_version: 1; run: unknown; plans: ExecutionPlan[] }>(runFile);
const runningRender = { ...readyTask(persisted.plans[0]!, "render_visual"), status: "running" as const };
persisted.plans = [withTask(persisted.plans[0]!, runningRender), persisted.plans[1]!];
await writeJson(runFile, persisted);
const resumeLock = await acquireResourceLocks({ storageRoot, config, task: runningRender });
assertCondition(resumeLock.acquired, "resume fixture render lock is acquired");
const resumed = await resumeSchedulerRun({ storageRoot, runId });
assertCondition(resumed.requeuedTasks.some((task) => task.task_id === runningRender.task_id), "resume requeues running task");
const locksAfterResume = await readResourceLocks(storageRoot);
assertCondition(!locksAfterResume.locks.some((lock) => lock.owner_task_id === runningRender.task_id), "resume releases task resource locks");

console.log(JSON.stringify({
  status: "passed",
  storage_root: storageRoot,
  run_id: runId,
  projects: projectIds,
  chains,
  timing_writer_count: timingWriters.length,
  initial_ready_projects: [...selectedProjects].sort(),
  scheduler_tick_executed: tickResult.executed_task_count,
  resource_lock_limited_task: secondRender.task_id,
  resumed_task: runningRender.task_id,
}, null, 2));

async function writeSchedulerFixtureProject(root: string, projectId: string): Promise<void> {
  const projectRoot = path.join(root, projectId);
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "lyrics.md"), "Question: fixture one\nAnswer: fixture two\n", "utf8");
  await writeFile(path.join(projectRoot, "active_music_take.mp3"), "scheduler-smoke-audio", "utf8");
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

function readyTask(plan: ExecutionPlan, stage: SchedulerTask["stage"]): SchedulerTask {
  const task = plan.tasks.find((candidate) => candidate.stage === stage);
  if (!task) throw new Error(`missing task stage ${stage}`);
  return { ...task, status: "ready" };
}

function withTaskStatus(plan: ExecutionPlan, task: SchedulerTask, status: SchedulerTask["status"]): ExecutionPlan {
  return withTask(plan, { ...task, status });
}

function withTask(plan: ExecutionPlan, task: SchedulerTask): ExecutionPlan {
  return {
    ...plan,
    tasks: plan.tasks.map((candidate) => candidate.task_id === task.task_id ? task : candidate),
  };
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function stamp(): string {
  return new Date().toISOString().replaceAll(/[^0-9]+/g, "").slice(0, 14);
}
