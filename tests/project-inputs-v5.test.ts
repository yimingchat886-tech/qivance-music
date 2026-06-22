import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createV5Project } from "../src/lib/project-core/project-create-v5.ts";
import { confirmV5ProjectInputs, uploadV5ProjectInputs } from "../src/lib/project-core/project-inputs-v5.ts";
import { closeQivancePrismaClient, createQivancePrismaClient } from "../src/lib/db/prisma-client.ts";
import { SOURCE_VIDEO_FIXTURE_PROBE } from "./source-video-fixture.ts";

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
    assert.equal(lyricsOnly.inputs[0]!.path, `inputs/lyrics/${lyricsOnly.inputs[0]!.id}.md`);
    await assert.rejects(confirmV5ProjectInputs(prisma, project.project_id), /requires active lyrics and audio/);

    const audioUpload = await uploadV5ProjectInputs(prisma, project.project_id, {
      audioFile: {
        filename: "take.mp3",
        mimeType: "audio/mpeg",
        data: Buffer.from([1, 2, 3, 4]),
      },
    });
    assert.equal(audioUpload.status, "input_uploaded");
    assert.equal(audioUpload.inputs[0]!.path, `inputs/audio/${audioUpload.inputs[0]!.id}.mp3`);

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
    const lockedInputSnapshot = JSON.parse(stored.runs[0]!.lockedInputsJson!);
    assert.equal(lockedInputSnapshot.schema_version, 1);
    assert.deepEqual(lockedInputSnapshot.inputs.map((input: { kind: string }) => input.kind), ["lyrics", "audio"]);
    assert.equal(lockedInputSnapshot.inputs[0].path, lyricsOnly.inputs[0]!.path);
    assert.equal(lockedInputSnapshot.inputs[0].stable_path, "lyrics.md");
    assert.equal(lockedInputSnapshot.inputs[1].path, audioUpload.inputs[0]!.path);
    assert.equal(lockedInputSnapshot.inputs[1].stable_path, "active_music_take.mp3");
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});

test("rejects duplicate input kinds in one upload request", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-project-inputs-v5-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const project = await createV5Project(prisma, {
      storageRoot,
      projectId: "v5_duplicate_upload_project",
      title: "V5 Duplicate Upload Project",
      contentType: "chat_dialogue_mv",
    });

    await assert.rejects(
      uploadV5ProjectInputs(prisma, project.project_id, {
        lyricsText: "line one\n",
        lyricsFile: {
          filename: "lyrics.txt",
          mimeType: "text/plain",
          data: Buffer.from("line two\n"),
        },
      }),
      /duplicate lyrics input kind: lyrics_text and lyrics_file/,
    );
    assert.equal(await prisma.projectInput.count({ where: { projectId: project.project_id } }), 0);
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

    const confirmed = await confirmV5ProjectInputs(prisma, project.project_id, {
      probeSourceVideo: async () => ({ ...SOURCE_VIDEO_FIXTURE_PROBE, hasAudioStream: false, audioStreamCount: 0, audio: undefined }),
    });
    assert.equal(confirmed.status, "queued");
    assert.equal(confirmed.task_count, 3);
    await stat(path.join(storageRoot, project.project_id, "source_video.mp4"));
    await stat(path.join(storageRoot, project.project_id, "data/source/source_video_import.json"));

    const stored = await prisma.project.findUniqueOrThrow({
      where: { id: project.project_id },
      include: { runs: { include: { tasks: true } }, artifacts: true },
    });
    assert.equal(stored.runs[0]?.mode, "preview");
    assert.deepEqual(stored.runs[0]?.tasks.map((task) => task.stage).sort(), [
      "build_video_frames",
      "prepare_video_context",
      "run_timing_pipeline",
    ].sort());
    assert.equal(stored.runs[0]?.tasks.some((task) => task.stage === "render_video_visual"), false);
    const lockedInputSnapshot = JSON.parse(stored.runs[0]!.lockedInputsJson!);
    assert.deepEqual(lockedInputSnapshot.inputs.map((input: { kind: string }) => input.kind), ["lyrics", "audio", "video"]);
    assert.equal(stored.artifacts.some((artifact) => artifact.path.startsWith("exports/video_chain/")), false);
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});
