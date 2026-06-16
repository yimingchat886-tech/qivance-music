import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { closeQivancePrismaClient, createQivancePrismaClient } from "../src/lib/db/prisma-client.ts";
import { createV5Project } from "../src/lib/project-core/project-create-v5.ts";
import { confirmV5ProjectInputs, uploadV5ProjectInputs } from "../src/lib/project-core/project-inputs-v5.ts";
import { requestV5RunStop } from "../src/lib/scheduler/db-run-store.ts";
import { recoverV5SchedulerRuns, updateV5RunTerminalStatus } from "../src/lib/scheduler/db-run-store.ts";
import { runV5SchedulerOnce, type V5SchedulerTaskHandlers } from "../src/lib/scheduler/server-runner-loop.ts";

test("DB-backed V5 runner claims ready tasks once and advances dependencies", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-runner-loop-v5-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const { runId, calls } = await createConfirmedRun(prisma, storageRoot, "runner_project");
    const handlers: Partial<V5SchedulerTaskHandlers> = {
      run_timing_pipeline: () => calls.push("run_timing_pipeline"),
      build_lyrics_line_map: () => calls.push("build_lyrics_line_map"),
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
