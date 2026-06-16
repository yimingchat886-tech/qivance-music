import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { closeQivancePrismaClient, createQivancePrismaClient } from "../src/lib/db/prisma-client.ts";
import { createV5Project } from "../src/lib/project-core/project-create-v5.ts";
import { confirmV5ProjectInputs, uploadV5ProjectInputs } from "../src/lib/project-core/project-inputs-v5.ts";
import { runV5SchedulerOnce } from "../src/lib/scheduler/server-runner-loop.ts";
import { createV5TaskHandlers, type V5TaskHandlerDeps } from "../src/lib/scheduler/v5-task-handlers.ts";
import { writeJson } from "../src/lib/fs-utils.ts";

test("V5 chat_dialogue_mv handlers produce final media, QA report, manifest, and artifacts", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-chat-runner-v5-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const { runId, projectRoot } = await createRunReadyAfterTiming(prisma, storageRoot, "chat_project");
    const handlers = createV5TaskHandlers(fakeMediaDeps());
    for (let index = 0; index < 12; index += 1) {
      await runV5SchedulerOnce(prisma, handlers);
    }

    const run = await prisma.schedulerRun.findUniqueOrThrow({ where: { id: runId }, include: { tasks: true } });
    assert.equal(run.status, "passed");
    assert.ok(run.tasks.every((task) => task.status === "passed"));

    const manifest = JSON.parse(await readFile(path.join(projectRoot, "exports/chat_dialogue_mv/render_manifest.json"), "utf8"));
    assert.equal(manifest.schema_version, 4);
    assert.equal(manifest.chain.id, "chat_dialogue_mv");
    assert.equal(manifest.production_gates.diagnostic_only, false);
    assert.equal(manifest.qa.audio_stream_count, 1);

    const qaReport = JSON.parse(await readFile(path.join(projectRoot, "data/chains/chat_dialogue_mv/qa_report.json"), "utf8"));
    assert.equal(qaReport.status, "passed");

    const artifacts = await prisma.artifact.findMany({ where: { projectId: "chat_project", createdByRunId: runId } });
    assert.ok(artifacts.some((artifact) => artifact.path === "exports/chat_dialogue_mv/final.mp4"));
    assert.ok(artifacts.some((artifact) => artifact.path === "exports/chat_dialogue_mv/render_manifest.json"));
    assert.ok(artifacts.some((artifact) => artifact.path === "data/chains/chat_dialogue_mv/qa_report.json"));
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});

test("V5 manifest handler fails when locked input sha no longer matches ProjectInput", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-chat-runner-v5-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const { runId, projectRoot } = await createRunReadyAfterTiming(prisma, storageRoot, "chat_mismatch_project");
    const handlers = createV5TaskHandlers(fakeMediaDeps());
    for (let index = 0; index < 7; index += 1) {
      await runV5SchedulerOnce(prisma, handlers);
    }
    const manifestTask = await prisma.schedulerTask.findFirstOrThrow({ where: { runId, stage: "write_manifest" } });
    assert.equal(manifestTask.status, "queued");

    await writeFile(path.join(projectRoot, "lyrics.md"), "tampered lyrics\n", "utf8");
    await runV5SchedulerOnce(prisma, handlers);

    const failedTask = await prisma.schedulerTask.findFirstOrThrow({ where: { runId, stage: "write_manifest" } });
    assert.equal(failedTask.status, "failed");
    assert.match(failedTask.lastError ?? "", /artifact_inconsistent/);
    const run = await prisma.schedulerRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(run.status, "failed");
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});

async function createRunReadyAfterTiming(
  prisma: Awaited<ReturnType<typeof createQivancePrismaClient>>,
  storageRoot: string,
  projectId: string,
): Promise<{ runId: string; projectRoot: string }> {
  const project = await createV5Project(prisma, {
    storageRoot,
    projectId,
    title: projectId,
    contentType: "chat_dialogue_mv",
  });
  await uploadV5ProjectInputs(prisma, project.project_id, {
    lyricsText: "Q: hello world\nA: answer now\n",
    audioFile: { filename: "take.mp3", mimeType: "audio/mpeg", data: Buffer.from("mp3") },
  });
  const confirmed = await confirmV5ProjectInputs(prisma, project.project_id);
  await writeTimingBundle(project.project_root);
  await prisma.schedulerTask.updateMany({
    where: { runId: confirmed.run_id, stage: "run_timing_pipeline" },
    data: { status: "passed", finishedAt: new Date() },
  });
  return { runId: confirmed.run_id, projectRoot: project.project_root };
}

async function writeTimingBundle(projectRoot: string): Promise<void> {
  await writeJson(path.join(projectRoot, "data/timing/beat_grid.json"), {
    schema_version: 1,
    duration_sec: 2,
    tempo_bpm: 120,
    tempo_candidates: [120],
    beats: [{ index: 0, time_sec: 0.5, confidence: 1 }],
  });
  await writeJson(path.join(projectRoot, "data/timing/onset_events.json"), {
    schema_version: 1,
    duration_sec: 2,
    events: [{ time_sec: 0.5, strength: 1 }],
  });
  await writeJson(path.join(projectRoot, "data/timing/energy_curve.json"), {
    schema_version: 1,
    duration_sec: 2,
    frame_hop_sec: 0.1,
    points: [{ time_sec: 0, rms: 0.1, normalized_energy: 1 }],
    low_energy_ranges: [],
  });
  await writeJson(path.join(projectRoot, "data/timing/lyric_word_timing.json"), {
    schema_version: 1,
    backend: "whisperx",
    duration_sec: 2,
    words: [
      { word_id: "w_000001", word: "hello", text: "hello", paragraph_id: "p_001", line_id: "line_001", start_sec: 0.1, end_sec: 0.6 },
      { word_id: "w_000002", word: "world", text: "world", paragraph_id: "p_001", line_id: "line_001", start_sec: 0.7, end_sec: 1.0 },
      { word_id: "w_000003", word: "answer", text: "answer", paragraph_id: "p_002", line_id: "line_002", start_sec: 1.1, end_sec: 1.5 },
      { word_id: "w_000004", word: "now", text: "now", paragraph_id: "p_002", line_id: "line_002", start_sec: 1.6, end_sec: 1.9 },
    ],
  });
  await writeJson(path.join(projectRoot, "data/timing/alignment_report.json"), {
    schema_version: 1,
    backend: "whisperx",
    status: "passed",
    metrics: { total_words: 4, aligned_words: 4, low_confidence_words: 0, unmatched_words: 0 },
  });
  await writeJson(path.join(projectRoot, "data/timing/section_map.json"), {
    schema_version: 1,
    duration_sec: 2,
    sections: [{ section_id: "sec_001", start_sec: 0, end_sec: 2 }],
  });
}

function fakeMediaDeps(): V5TaskHandlerDeps {
  return {
    renderChatFramesToVisual: async (input) => {
      await writeFile(input.outputPath, "visual mp4");
      return { visual_path: "exports/chat_dialogue_mv/visual.mp4", frame_renders: [] };
    },
    muxLockedAudio: async (input) => {
      await writeFile(input.finalMp4Path, "final mp4");
    },
    ffprobeJson: async (filePath: string) => {
      if (filePath.endsWith("final.mp4")) {
        return { streams: [{ codec_type: "video" }, { codec_type: "audio" }], format: { duration: "2.000" } };
      }
      return { streams: [{ codec_type: "audio" }], format: { duration: "2.000" } };
    },
  };
}
