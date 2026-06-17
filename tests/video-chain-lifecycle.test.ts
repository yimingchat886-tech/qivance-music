import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { closeQivancePrismaClient, createQivancePrismaClient } from "../src/lib/db/prisma-client.ts";
import { createV5Project } from "../src/lib/project-core/project-create-v5.ts";
import { confirmV5ProjectInputs, uploadV5ProjectInputs } from "../src/lib/project-core/project-inputs-v5.ts";
import { runV5SchedulerOnce, type V5SchedulerTaskHandlers } from "../src/lib/scheduler/server-runner-loop.ts";
import { SOURCE_VIDEO_FIXTURE_PROBE } from "./source-video-fixture.ts";

const VIDEO_PREVIEW_STAGES = [
  "run_timing_pipeline",
  "prepare_video_context",
  "build_video_frames",
];

const VIDEO_EXPORT_STAGES = [
  "render_video_visual",
  "mux_video_final",
  "video_qa_report",
  "write_video_manifest",
];

const VIDEO_FINAL_EXPORT_PATHS = [
  "exports/video_chain/visual.mp4",
  "exports/video_chain/final.mp4",
  "data/chains/video_chain/qa_report.json",
  "exports/video_chain/render_manifest.json",
];

const CHAT_STAGES = [
  "run_timing_pipeline",
  "build_lyrics_line_map",
  "build_speaker_attribution",
  "build_conversation_plan",
  "build_chat_frames",
  "render_visual",
  "mux_final",
  "qa_report",
  "write_manifest",
];

test("video_chain confirm creates preview-only run and preview completion reaches ready", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-video-chain-lifecycle-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const project = await createV5Project(prisma, {
      storageRoot,
      projectId: "video_lifecycle_project",
      title: "Video Lifecycle Project",
      contentType: "video_chain",
    });
    await uploadV5ProjectInputs(prisma, project.project_id, {
      lyricsText: "line one\nline two\n",
      audioFile: { filename: "take.mp3", mimeType: "audio/mpeg", data: Buffer.from([1, 2, 3]) },
      videoFile: { filename: "background.mp4", mimeType: "video/mp4", data: Buffer.from([4, 5, 6]) },
    });

    const confirmed = await confirmV5ProjectInputs(prisma, project.project_id, {
      probeSourceVideo: async () => ({ ...SOURCE_VIDEO_FIXTURE_PROBE, hasAudioStream: false, audioStreamCount: 0, audio: undefined }),
    });
    assert.equal(confirmed.status, "queued");
    assert.equal(confirmed.task_count, 3);

    const runBefore = await prisma.schedulerRun.findUniqueOrThrow({
      where: { id: confirmed.run_id },
      include: { tasks: true },
    });
    assert.equal(runBefore.mode, "preview");
    assert.deepEqual(runBefore.tasks.map((task) => task.stage).sort(), [...VIDEO_PREVIEW_STAGES].sort());
    assert.equal(runBefore.tasks.some((task) => VIDEO_EXPORT_STAGES.includes(task.stage)), false);
    assert.equal(await prisma.artifact.count({ where: { projectId: project.project_id, path: { startsWith: "exports/video_chain/" } } }), 0);

    const handlers: Partial<V5SchedulerTaskHandlers> = {
      run_timing_pipeline: async ({ prisma, task }) => writeDeclaredOutputs(prisma, task),
      prepare_video_context: async ({ prisma, task }) => writeDeclaredOutputs(prisma, task),
      build_video_frames: async ({ prisma, task }) => {
        await writeDeclaredOutputs(prisma, task);
        const agentRunPath = "video/html-video/.html-video/projects/video_lifecycle_project/agent_runs/agent_run_preview.json";
        const dbProject = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
        await writeProjectFile(dbProject.projectRoot, agentRunPath, "{\"schema_version\":1}");
        return {
          outputArtifacts: [{
            path: agentRunPath,
            kind: "agent_run",
            schemaVersion: "1",
          }],
        };
      },
    };

    for (const _stage of VIDEO_PREVIEW_STAGES) {
      const tick = await runV5SchedulerOnce(prisma, handlers);
      assert.equal(tick.executed_task_count, 1);
    }

    const stored = await prisma.project.findUniqueOrThrow({
      where: { id: project.project_id },
      include: {
        chains: true,
        runs: { include: { tasks: true } },
        artifacts: true,
      },
    });
    assert.equal(stored.status, "ready");
    assert.equal(stored.chains[0]?.status, "ready");
    assert.equal(stored.runs[0]?.status, "ready");
    assert.equal(stored.artifacts.some((artifact) => VIDEO_FINAL_EXPORT_PATHS.includes(artifact.path)), false);
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});

test("chat_dialogue_mv confirm remains production full-chain and can reach passed", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-chat-lifecycle-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const project = await createV5Project(prisma, {
      storageRoot,
      projectId: "chat_lifecycle_project",
      title: "Chat Lifecycle Project",
      contentType: "chat_dialogue_mv",
    });
    await uploadV5ProjectInputs(prisma, project.project_id, {
      lyricsText: "问：hello\n答：world\n",
      audioFile: { filename: "take.mp3", mimeType: "audio/mpeg", data: Buffer.from([1, 2, 3]) },
    });

    const confirmed = await confirmV5ProjectInputs(prisma, project.project_id);
    assert.equal(confirmed.task_count, 9);
    const runBefore = await prisma.schedulerRun.findUniqueOrThrow({
      where: { id: confirmed.run_id },
      include: { tasks: true },
    });
    assert.equal(runBefore.mode, "production");
    assert.deepEqual(runBefore.tasks.map((task) => task.stage).sort(), [...CHAT_STAGES].sort());

    const handlers = Object.fromEntries(CHAT_STAGES.map((stage) => [
      stage,
      async ({ prisma, task }: Parameters<V5SchedulerTaskHandlers[string]>[0]) => writeDeclaredOutputs(prisma, task),
    ])) as Partial<V5SchedulerTaskHandlers>;

    for (const _stage of CHAT_STAGES) {
      const tick = await runV5SchedulerOnce(prisma, handlers);
      assert.equal(tick.executed_task_count, 1);
    }

    const stored = await prisma.project.findUniqueOrThrow({
      where: { id: project.project_id },
      include: { chains: true, runs: true },
    });
    assert.equal(stored.status, "passed");
    assert.equal(stored.chains[0]?.status, "passed");
    assert.equal(stored.runs[0]?.status, "passed");
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});

async function writeDeclaredOutputs(
  prisma: Awaited<ReturnType<typeof createQivancePrismaClient>>,
  task: { projectId: string; outputArtifactsJson: string },
): Promise<void> {
  const dbProject = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
  const outputs = JSON.parse(task.outputArtifactsJson) as string[];
  for (const relativePath of outputs) {
    if (relativePath.includes("<")) continue;
    await writeProjectFile(dbProject.projectRoot, relativePath, "artifact");
  }
}

async function writeProjectFile(projectRoot: string, relativePath: string, contents: string): Promise<void> {
  const absolutePath = path.join(projectRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
}
