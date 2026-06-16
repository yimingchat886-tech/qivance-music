import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import test from "node:test";
import { createControlPlaneProject, createControlPlaneId } from "../src/lib/db/control-plane.ts";
import {
  closeQivancePrismaClient,
  createQivancePrismaClient,
  resolveControlPlaneDatabasePath,
} from "../src/lib/db/prisma-client.ts";

test("initializes V5 SQLite control plane and stores metadata rows only", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-control-plane-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    await stat(resolveControlPlaneDatabasePath(storageRoot));

    const project = await createControlPlaneProject(prisma, {
      storageRoot,
      projectId: "v5_control_plane_project",
      title: "V5 Control Plane",
      contentType: "chat_dialogue_mv",
    });
    const runId = createControlPlaneId("run");
    const taskId = createControlPlaneId("task");

    await prisma.projectInput.create({
      data: {
        id: createControlPlaneId("input"),
        projectId: project.id,
        kind: "lyrics",
        status: "active",
        originalName: "lyrics.md",
        path: "inputs/lyrics/lyrics_20260615.md",
        stablePath: "lyrics.md",
        sha256: "a".repeat(64),
        mime: "text/markdown",
      },
    });
    await prisma.chain.create({
      data: {
        id: createControlPlaneId("chain"),
        projectId: project.id,
        chainId: "chat_dialogue_mv",
        status: "input_required",
      },
    });
    await prisma.schedulerRun.create({
      data: {
        id: runId,
        projectId: project.id,
        status: "queued",
        mode: "production",
        priority: 50,
      },
    });
    await prisma.schedulerTask.create({
      data: {
        id: taskId,
        runId,
        projectId: project.id,
        chainId: "chat_dialogue_mv",
        stage: "run_timing_pipeline",
        status: "queued",
        dependenciesJson: "[]",
        resourceRequirementsJson: "[\"audio_analysis\"]",
        inputArtifactsJson: "[]",
        outputArtifactsJson: "[\"data/timing/section_map.json\"]",
      },
    });
    await prisma.schedulerEvent.create({
      data: {
        id: createControlPlaneId("event"),
        runId,
        taskId,
        eventType: "run_created",
        message: "Scheduler run created.",
        detailsJson: "{\"source\":\"test\"}",
      },
    });
    await prisma.artifact.create({
      data: {
        id: createControlPlaneId("artifact"),
        projectId: project.id,
        chainId: "chat_dialogue_mv",
        kind: "section_map",
        path: "data/timing/section_map.json",
        sha256: "b".repeat(64),
        schemaVersion: "1",
        status: "current",
        createdByRunId: runId,
      },
    });

    const stored = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
      include: {
        inputs: true,
        artifacts: true,
        chains: true,
        runs: { include: { tasks: true, events: true } },
      },
    });
    assert.equal(stored.inputs.length, 1);
    assert.equal(stored.artifacts[0].path, "data/timing/section_map.json");
    assert.equal(stored.chains[0].chainId, "chat_dialogue_mv");
    assert.equal(stored.runs[0].tasks[0].stage, "run_timing_pipeline");
    assert.equal(stored.runs[0].events[0].eventType, "run_created");

    const db = new DatabaseSync(resolveControlPlaneDatabasePath(storageRoot), { readOnly: true });
    try {
      const tables = ["project_inputs", "artifacts", "scheduler_tasks"];
      for (const table of tables) {
        const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string; type: string }>;
        assert.equal(columns.some((column) => column.type.toUpperCase() === "BLOB"), false);
        assert.equal(columns.some((column) => column.name === "data"), false);
      }
    } finally {
      db.close();
    }
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});
