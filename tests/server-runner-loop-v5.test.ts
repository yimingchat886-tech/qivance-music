import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { closeQivancePrismaClient, createQivancePrismaClient } from "../src/lib/db/prisma-client.ts";
import { createV5Project } from "../src/lib/project-core/project-create-v5.ts";
import { confirmV5ProjectInputs, uploadV5ProjectInputs } from "../src/lib/project-core/project-inputs-v5.ts";
import { requestV5RunStop } from "../src/lib/scheduler/db-run-store.ts";
import { recoverV5SchedulerRuns, updateV5RunTerminalStatus } from "../src/lib/scheduler/db-run-store.ts";
import { runV5SchedulerOnce, startV5RunnerLoop, type V5SchedulerTaskHandlers } from "../src/lib/scheduler/server-runner-loop.ts";

test("DB-backed V5 runner claims ready tasks once and advances dependencies", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-runner-loop-v5-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const { runId, calls } = await createConfirmedRun(prisma, storageRoot, "runner_project");
    const handlers: Partial<V5SchedulerTaskHandlers> = {
      run_timing_pipeline: async ({ prisma, task }) => {
        calls.push("run_timing_pipeline");
        await writeDeclaredOutputs(prisma, task);
      },
      build_lyrics_line_map: async ({ prisma, task }) => {
        calls.push("build_lyrics_line_map");
        await writeDeclaredOutputs(prisma, task);
      },
    };

    const first = await runV5SchedulerOnce(prisma, handlers);
    assert.equal(first.executed_task_count, 1);
    assert.deepEqual(calls, ["run_timing_pipeline"]);
    const second = await runV5SchedulerOnce(prisma, handlers);
    assert.equal(second.executed_task_count, 1);
    assert.deepEqual(calls, ["run_timing_pipeline", "build_lyrics_line_map"]);

    const run = await prisma.schedulerRun.findUniqueOrThrow({ where: { id: runId }, include: { events: true } });
    assert.equal(run.status, "queued");
    assert.ok(run.events.some((event) => event.eventType === "task_passed"));
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});

test("V5 runner loop does not re-enter while a tick is in flight and drain waits for it", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-runner-loop-v5-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const started = deferred();
    const blocker = deferred();
    let calls = 0;
    const { runId } = await createConfirmedRun(prisma, storageRoot, "drain_project");
    const handle = await startV5RunnerLoop({
      prisma,
      intervalMs: 1,
      handlers: {
        run_timing_pipeline: async ({ prisma, task }) => {
          calls += 1;
          started.resolve();
          await blocker.promise;
          await writeDeclaredOutputs(prisma, task);
        },
      },
    });

    await withTimeout(started.promise, 1000);
    await delay(25);
    assert.equal(calls, 1);
    assert.equal(handle.isRunning(), true);

    let stopped = false;
    const stopPromise = handle.stop({ drain: true }).then(() => {
      stopped = true;
    });
    await delay(10);
    assert.equal(stopped, false);
    blocker.resolve();
    await stopPromise;

    assert.equal(stopped, true);
    assert.equal(handle.isRunning(), false);
    assert.equal((await prisma.schedulerTask.findFirstOrThrow({ where: { runId, stage: "run_timing_pipeline" } })).status, "passed");
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});

test("V5 runner loop records interval-level errors as scheduler events", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-runner-loop-v5-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const { runId } = await createConfirmedRun(prisma, storageRoot, "loop_error_project");
    await prisma.schedulerTask.updateMany({
      where: { runId, stage: "run_timing_pipeline" },
      data: { dependenciesJson: "not-json" },
    });

    const handle = await startV5RunnerLoop({ prisma, handlers: {}, intervalMs: 1 });
    const event = await waitFor(async () => {
      return prisma.schedulerEvent.findFirst({ where: { eventType: "runner_loop_error" } });
    });
    await handle.stop({ drain: true });

    assert.match(event.message, /JSON|not-json|Unexpected/i);
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});

test("V5 runner fails a task when required static output artifacts are missing", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-runner-loop-v5-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const { runId } = await createConfirmedRun(prisma, storageRoot, "missing_artifact_project");
    const result = await runV5SchedulerOnce(prisma, {
      run_timing_pipeline: () => undefined,
    });

    assert.equal(result.failed_task_count, 1);
    const task = await prisma.schedulerTask.findFirstOrThrow({ where: { runId, stage: "run_timing_pipeline" } });
    assert.equal(task.status, "failed");
    assert.match(task.lastError ?? "", /artifact_missing: required output artifact is missing/);
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});

test("V5 runner records handler-returned dynamic output artifacts without statting placeholders", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-runner-loop-v5-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const { runId } = await createConfirmedRun(prisma, storageRoot, "dynamic_artifact_project");
    await prisma.schedulerTask.updateMany({
      where: { runId, stage: "run_timing_pipeline" },
      data: {
        outputArtifactsJson: JSON.stringify([
          "data/timing/section_map.json",
          "video/html-video/.html-video/projects/<project_id>/agent_runs/<agent_run_id>.json",
        ]),
      },
    });

    const result = await runV5SchedulerOnce(prisma, {
      run_timing_pipeline: async ({ prisma, task }) => {
        await writeDeclaredOutputs(prisma, task);
        const project = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
        const agentRunPath = "video/html-video/.html-video/projects/dynamic_artifact_project/agent_runs/agent_run_actual.json";
        await writeProjectFile(project.projectRoot, agentRunPath, JSON.stringify({ schema_version: 1 }));
        return {
          outputArtifacts: [{
            path: agentRunPath,
            kind: "agent_run",
            schemaVersion: "1",
          }],
        };
      },
    });

    assert.equal(result.executed_task_count, 1);
    const artifacts = await prisma.artifact.findMany({ where: { createdByRunId: runId }, orderBy: { path: "asc" } });
    assert.deepEqual(artifacts.map((artifact) => artifact.path), [
      "data/timing/section_map.json",
      "video/html-video/.html-video/projects/dynamic_artifact_project/agent_runs/agent_run_actual.json",
    ]);
    assert.equal(artifacts.find((artifact) => artifact.kind === "agent_run")?.schemaVersion, "1");
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});

test("stopRequested prevents launching additional queued tasks after the running handler finishes", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-runner-loop-v5-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const { runId } = await createConfirmedRun(prisma, storageRoot, "stop_requested_project");
    let timingCalls = 0;
    let lyricsCalls = 0;
    const handle = await startV5RunnerLoop({
      prisma,
      intervalMs: 1,
      handlers: {
        run_timing_pipeline: async ({ prisma, run, task }) => {
          timingCalls += 1;
          await writeDeclaredOutputs(prisma, task);
          await requestV5RunStop(prisma, { projectId: task.projectId, runId: run.id });
        },
        build_lyrics_line_map: () => {
          lyricsCalls += 1;
        },
      },
    });

    await waitFor(async () => timingCalls === 1);
    await delay(30);
    await handle.stop({ drain: true });

    assert.equal(timingCalls, 1);
    assert.equal(lyricsCalls, 0);
    assert.equal(await updateV5RunTerminalStatus(prisma, runId), "stopped");
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});

test("DB-backed V5 runner supports graceful stop and restart recovery", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-runner-loop-v5-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const { runId } = await createConfirmedRun(prisma, storageRoot, "stop_project");
    await prisma.schedulerTask.updateMany({
      where: { runId, stage: "run_timing_pipeline" },
      data: { status: "running" },
    });
    await prisma.schedulerRun.update({ where: { id: runId }, data: { status: "running" } });

    const recovered = await recoverV5SchedulerRuns(prisma);
    assert.equal(recovered.recovered_task_count, 1);
    assert.equal((await prisma.schedulerTask.findFirstOrThrow({ where: { runId, stage: "run_timing_pipeline" } })).status, "queued");

    const stopped = await requestV5RunStop(prisma, { projectId: "stop_project", runId });
    assert.equal(stopped.stopped_task_count, 9);
    assert.equal(await updateV5RunTerminalStatus(prisma, runId), "stopped");
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});

async function createConfirmedRun(
  prisma: Awaited<ReturnType<typeof createQivancePrismaClient>>,
  storageRoot: string,
  projectId: string,
): Promise<{ runId: string; calls: string[] }> {
  const project = await createV5Project(prisma, {
    storageRoot,
    projectId,
    title: projectId,
    contentType: "chat_dialogue_mv",
  });
  await uploadV5ProjectInputs(prisma, project.project_id, {
    lyricsText: "hello world",
    audioFile: { filename: "take.mp3", mimeType: "audio/mpeg", data: Buffer.from([1, 2, 3]) },
  });
  const confirmed = await confirmV5ProjectInputs(prisma, project.project_id);
  return { runId: confirmed.run_id, calls: [] };
}

async function writeDeclaredOutputs(
  prisma: Awaited<ReturnType<typeof createQivancePrismaClient>>,
  task: { projectId: string; outputArtifactsJson: string },
): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
  const outputs = JSON.parse(task.outputArtifactsJson) as string[];
  for (const relativePath of outputs) {
    if (relativePath.includes("<")) continue;
    await writeProjectFile(project.projectRoot, relativePath, "artifact");
  }
}

async function writeProjectFile(projectRoot: string, relativePath: string, contents: string): Promise<void> {
  const absolutePath = path.join(projectRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function waitFor<T>(read: () => Promise<T | null | false> | T | null | false, timeoutMs = 1000): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await read();
    if (value) return value;
    await delay(5);
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
