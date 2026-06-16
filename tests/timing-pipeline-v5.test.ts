import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { closeQivancePrismaClient, createQivancePrismaClient } from "../src/lib/db/prisma-client.ts";
import { createV5Project } from "../src/lib/project-core/project-create-v5.ts";
import { confirmV5ProjectInputs, uploadV5ProjectInputs } from "../src/lib/project-core/project-inputs-v5.ts";
import { runV5SchedulerOnce } from "../src/lib/scheduler/server-runner-loop.ts";
import { createV5TaskHandlers } from "../src/lib/scheduler/v5-task-handlers.ts";
import { writeJson } from "../src/lib/fs-utils.ts";

test("V5 timing handler writes production timing artifacts and DB artifact rows", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-timing-v5-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const { runId, projectRoot } = await createConfirmedRun(prisma, storageRoot, "timing_project");
    const result = await runV5SchedulerOnce(prisma, createV5TaskHandlers({
      ffprobeJson: async () => durationProbe(2),
      runAudioAnalysis: async ({ outputDir }) => {
        await writeAudioAnalysis(outputDir, 2);
      },
      runWhisperXAlignment: async (input) => {
        await writeJson(input.wordTimingPath, {
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
        await writeJson(input.reportPath, {
          schema_version: 1,
          backend: "whisperx",
          status: "passed",
          metrics: { total_words: 4, aligned_words: 4, low_confidence_words: 0, unmatched_words: 0 },
        });
        return { stdout: "", stderr: "", wordTiming: JSON.parse(await readFile(input.wordTimingPath, "utf8")), alignmentReport: JSON.parse(await readFile(input.reportPath, "utf8")) };
      },
    }));

    assert.equal(result.executed_task_count, 1);
    for (const relativePath of [
      "data/timing/beat_grid.json",
      "data/timing/onset_events.json",
      "data/timing/energy_curve.json",
      "data/timing/lyric_word_timing.json",
      "data/timing/alignment_report.json",
      "data/timing/section_map.json",
    ]) {
      assert.ok(JSON.parse(await readFile(path.join(projectRoot, relativePath), "utf8")));
    }
    const artifacts = await prisma.artifact.findMany({ where: { projectId: "timing_project", createdByRunId: runId } });
    assert.equal(artifacts.length, 6);
    assert.ok(artifacts.some((artifact) => artifact.path === "data/timing/section_map.json"));
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});

test("V5 timing handler maps missing local dependencies to timing_blocked", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-timing-v5-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const { runId } = await createConfirmedRun(prisma, storageRoot, "timing_blocked_project");
    const result = await runV5SchedulerOnce(prisma, createV5TaskHandlers({
      ffprobeJson: async () => durationProbe(2),
      runAudioAnalysis: async () => {
        throw new Error("No module named librosa");
      },
    }));
    assert.equal(result.blocked_task_count, 1);
    const task = await prisma.schedulerTask.findFirstOrThrow({ where: { runId, stage: "run_timing_pipeline" } });
    assert.equal(task.status, "blocked");
    assert.match(task.lastError ?? "", /^timing_blocked:/);
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});

async function createConfirmedRun(
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
  return { runId: confirmed.run_id, projectRoot: project.project_root };
}

async function writeAudioAnalysis(outputDir: string, durationSec: number): Promise<void> {
  await writeJson(path.join(outputDir, "beat_grid.json"), {
    schema_version: 1,
    duration_sec: durationSec,
    tempo_bpm: 120,
    tempo_candidates: [120],
    beats: [{ index: 0, time_sec: 0.5, confidence: 1 }],
  });
  await writeJson(path.join(outputDir, "onset_events.json"), {
    schema_version: 1,
    duration_sec: durationSec,
    events: [{ time_sec: 0.5, strength: 1 }],
  });
  await writeJson(path.join(outputDir, "energy_curve.json"), {
    schema_version: 1,
    duration_sec: durationSec,
    frame_hop_sec: 0.1,
    points: [{ time_sec: 0, rms: 0.1, normalized_energy: 1 }],
    low_energy_ranges: [],
  });
}

function durationProbe(durationSec: number): Record<string, unknown> {
  return {
    streams: [{ codec_type: "audio", duration: String(durationSec) }],
    format: { duration: String(durationSec) },
  };
}
