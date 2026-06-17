import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createV5Project } from "../src/lib/project-core/project-create-v5.ts";
import { closeQivancePrismaClient, createQivancePrismaClient } from "../src/lib/db/prisma-client.ts";

test("creates a DB-backed V5 project without starting a scheduler run", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-project-create-v5-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const created = await createV5Project(prisma, {
      storageRoot,
      projectId: "v5_created_project",
      title: "  V5 Created Project  ",
      contentType: "chat_dialogue_mv",
      description: "internal test",
    });

    assert.deepEqual({
      project_id: created.project_id,
      status: created.status,
      chain_id: created.chain_id,
    }, {
      project_id: "v5_created_project",
      status: "input_required",
      chain_id: "chat_dialogue_mv",
    });
    await stat(path.join(storageRoot, created.project_id, "inputs", "lyrics"));
    await stat(path.join(storageRoot, created.project_id, "inputs", "audio"));
    await stat(path.join(storageRoot, created.project_id, "data", "timing"));
    await stat(path.join(storageRoot, created.project_id, "exports", "chat_dialogue_mv"));

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: created.project_id },
      include: { chains: true, runs: true },
    });
    assert.equal(project.title, "V5 Created Project");
    assert.equal(project.status, "input_required");
    assert.equal(project.contentType, "chat_dialogue_mv");
    assert.equal(project.chains.length, 1);
    assert.equal(project.chains[0]?.chainId, "chat_dialogue_mv");
    assert.equal(project.runs.length, 0);
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});

test("rejects unsupported V5 project content types", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-project-create-v5-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    await assert.rejects(
      createV5Project(prisma, {
        storageRoot,
        title: "Rejected Project",
        contentType: "unknown_chain",
      }),
      /Unsupported V5 chain/,
    );
    assert.equal(await prisma.project.count(), 0);
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});

test("creates a V6 video_chain project with video input and chain directories", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-project-create-v5-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const created = await createV5Project(prisma, {
      storageRoot,
      projectId: "v6_video_project",
      title: "V6 Video Project",
      contentType: "video_chain",
    });

    assert.equal(created.chain_id, "video_chain");
    await stat(path.join(storageRoot, created.project_id, "inputs", "lyrics"));
    await stat(path.join(storageRoot, created.project_id, "inputs", "audio"));
    await stat(path.join(storageRoot, created.project_id, "inputs", "video"));
    await stat(path.join(storageRoot, created.project_id, "data", "source"));
    await stat(path.join(storageRoot, created.project_id, "data", "chains", "video_chain"));
    await stat(path.join(storageRoot, created.project_id, "exports", "video_chain"));

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: created.project_id },
      include: { chains: true },
    });
    assert.equal(project.contentType, "video_chain");
    assert.equal(project.chains[0]?.chainId, "video_chain");
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});
