import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createV5Project } from "../src/lib/project-core/project-create-v5.ts";
import { confirmV5ProjectInputs, uploadV5ProjectInputs } from "../src/lib/project-core/project-inputs-v5.ts";
import { closeQivancePrismaClient, createQivancePrismaClient } from "../src/lib/db/prisma-client.ts";

test("uploads partial V5 inputs and confirms only after lyrics and audio exist", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-project-inputs-v5-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const project = await createV5Project(prisma, {
      storageRoot,
      projectId: "v5_inputs_project",
      title: "V5 Inputs Project",
      contentType: "chat_dialogue_mv",
    });

    const lyricsOnly = await uploadV5ProjectInputs(prisma, project.project_id, {
      lyricsText: "line one\nline two\n",
    });
    assert.equal(lyricsOnly.status, "input_required");
    await assert.rejects(confirmV5ProjectInputs(prisma, project.project_id), /requires active lyrics and audio/);

    const audioUpload = await uploadV5ProjectInputs(prisma, project.project_id, {
      audioFile: {
        filename: "take.mp3",
        mimeType: "audio/mpeg",
        data: Buffer.from([1, 2, 3, 4]),
      },
    });
    assert.equal(audioUpload.status, "input_uploaded");

    const confirmed = await confirmV5ProjectInputs(prisma, project.project_id);
    assert.equal(confirmed.status, "queued");
    assert.equal(confirmed.task_count, 9);
    assert.deepEqual(await readFile(path.join(storageRoot, project.project_id, "lyrics.md"), "utf8"), "line one\nline two\n");
    assert.deepEqual(await readFile(path.join(storageRoot, project.project_id, "active_music_take.mp3")), Buffer.from([1, 2, 3, 4]));

    const stored = await prisma.project.findUniqueOrThrow({
      where: { id: project.project_id },
      include: { runs: { include: { tasks: true, events: true } } },
    });
    assert.equal(stored.status, "queued");
    assert.equal(stored.runs.length, 1);
    assert.equal(stored.runs[0]?.status, "queued");
    assert.equal(stored.runs[0]?.tasks.length, 9);
    assert.equal(stored.runs[0]?.events[0]?.eventType, "run_created");
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});

test("requires explicit replace and rejects replacement during queued work", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-project-inputs-v5-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const project = await createV5Project(prisma, {
      storageRoot,
      projectId: "v5_replace_project",
      title: "V5 Replace Project",
      contentType: "chat_dialogue_mv",
    });
    await uploadV5ProjectInputs(prisma, project.project_id, {
      lyricsText: "first",
      audioFile: {
        filename: "first.wav",
        mimeType: "audio/wav",
        data: Buffer.from([1]),
      },
    });
    await assert.rejects(
      uploadV5ProjectInputs(prisma, project.project_id, { lyricsText: "second" }),
      /replace=true/,
    );

    await uploadV5ProjectInputs(prisma, project.project_id, {
      lyricsText: "second",
      replace: true,
    });
    const activeLyrics = await prisma.projectInput.findMany({
      where: { projectId: project.project_id, kind: "lyrics", status: "active" },
    });
    assert.equal(activeLyrics.length, 1);
    assert.equal(await prisma.projectInput.count({ where: { projectId: project.project_id, kind: "lyrics", status: "superseded" } }), 1);

    await confirmV5ProjectInputs(prisma, project.project_id);
    await assert.rejects(
      uploadV5ProjectInputs(prisma, project.project_id, {
        audioFile: { filename: "next.mp3", mimeType: "audio/mpeg", data: Buffer.from([2]) },
        replace: true,
      }),
      /Cannot replace inputs while project status is queued/,
    );
    await stat(path.join(storageRoot, project.project_id, activeLyrics[0]!.path));
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});

test("video_chain requires an active MP4 input before confirmation", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-project-inputs-v5-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const project = await createV5Project(prisma, {
      storageRoot,
      projectId: "v6_video_inputs_project",
      title: "V6 Video Inputs Project",
      contentType: "video_chain",
    });

    const audioAndLyrics = await uploadV5ProjectInputs(prisma, project.project_id, {
      lyricsText: "line one\nline two\n",
      audioFile: {
        filename: "take.mp3",
        mimeType: "audio/mpeg",
        data: Buffer.from([1, 2, 3, 4]),
      },
    });
    assert.equal(audioAndLyrics.status, "input_required");
    await assert.rejects(confirmV5ProjectInputs(prisma, project.project_id), /requires active lyrics, audio, and video/);

    const videoUpload = await uploadV5ProjectInputs(prisma, project.project_id, {
      videoFile: {
        filename: "background.mp4",
        mimeType: "video/mp4",
        data: Buffer.from([5, 6, 7, 8]),
      },
    });
    assert.equal(videoUpload.status, "input_uploaded");

    const storedVideo = await prisma.projectInput.findFirstOrThrow({
      where: { projectId: project.project_id, kind: "video", status: "active" },
    });
    assert.equal(storedVideo.stablePath, "source_video.mp4");
    await stat(path.join(storageRoot, project.project_id, storedVideo.path));
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});
