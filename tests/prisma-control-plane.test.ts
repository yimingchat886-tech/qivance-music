import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import test from "node:test";
import { createControlPlaneProject, createControlPlaneId } from "../src/lib/db/control-plane.ts";
import {
  closeQivancePrismaClient,
  createQivancePrismaClient,
  ensureControlPlaneDatabase,
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

test("migration supersedes duplicate active inputs before enforcing one active input per kind", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-control-plane-"));
  const projectId = "duplicate_active_inputs_project";
  const db = new DatabaseSync(resolveControlPlaneDatabasePath(storageRoot));
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(`CREATE TABLE "_qivance_migrations" (
      "name" TEXT NOT NULL PRIMARY KEY,
      "applied_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    db.exec(await readFile(path.join(process.cwd(), "prisma/migrations/20260615000000_v5_control_plane/migration.sql"), "utf8"));
    db.prepare(`INSERT INTO "_qivance_migrations" ("name") VALUES (?)`).run("20260615000000_v5_control_plane");
    db.prepare(`INSERT INTO "projects" ("id", "title", "content_type", "status", "project_root") VALUES (?, ?, ?, ?, ?)`)
      .run(projectId, "Duplicate Active Inputs", "chat_dialogue_mv", "input_uploaded", path.join(storageRoot, projectId));
    const insertInput = db.prepare(`INSERT INTO "project_inputs" (
      "id", "project_id", "kind", "status", "original_name", "path", "stable_path", "sha256", "mime", "created_at"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insertInput.run(
      "input_old",
      projectId,
      "lyrics",
      "active",
      "old.md",
      "inputs/lyrics/input_old.md",
      "lyrics.md",
      "a".repeat(64),
      "text/markdown",
      "2026-06-17 10:00:00",
    );
    insertInput.run(
      "input_new",
      projectId,
      "lyrics",
      "active",
      "new.md",
      "inputs/lyrics/input_new.md",
      "lyrics.md",
      "b".repeat(64),
      "text/markdown",
      "2026-06-17 11:00:00",
    );
  } finally {
    db.close();
  }

  await ensureControlPlaneDatabase(storageRoot);
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const inputs = await prisma.projectInput.findMany({
      where: { projectId, kind: "lyrics" },
      orderBy: { id: "asc" },
    });
    assert.deepEqual(inputs.map((input) => [input.id, input.status]), [
      ["input_new", "active"],
      ["input_old", "superseded"],
    ]);
    await assert.rejects(
      prisma.projectInput.create({
        data: {
          id: "input_duplicate",
          projectId,
          kind: "lyrics",
          status: "active",
          originalName: "duplicate.md",
          path: "inputs/lyrics/input_duplicate.md",
          stablePath: "lyrics.md",
          sha256: "c".repeat(64),
          mime: "text/markdown",
        },
      }),
      /Unique constraint failed|constraint failed/i,
    );

    const dbAfter = new DatabaseSync(resolveControlPlaneDatabasePath(storageRoot), { readOnly: true });
    try {
      const columns = dbAfter.prepare(`PRAGMA table_info("scheduler_runs")`).all() as Array<{ name: string }>;
      assert.equal(columns.some((column) => column.name === "locked_inputs_json"), true);
    } finally {
      dbAfter.close();
    }
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});
