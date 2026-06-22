import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { closeQivancePrismaClient, createQivancePrismaClient } from "../src/lib/db/prisma-client.ts";
import { createV5Project } from "../src/lib/project-core/project-create-v5.ts";
import { writeJson } from "../src/lib/fs-utils.ts";
import {
  buildVideoChainFrames,
  muxVideoChainFinal,
  prepareVideoChainContext,
  renderVideoChainVisual,
  writeVideoChainManifest,
  writeVideoChainQaReport,
} from "../src/lib/video-chain/video-chain-runner.ts";
import { loadHtmlVideoPreviewModel } from "../src/lib/video-html/preview-model.ts";
import { resolveSmallProjectPaths } from "../src/lib/project-core/paths.ts";
import { writeSourceVideoFixture } from "./source-video-fixture.ts";

test("video_chain runner builds MP4-background html-video preview and explicit final export", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-video-chain-runner-"));
  const prisma = await createQivancePrismaClient(storageRoot);
  try {
    const created = await createV5Project(prisma, {
      storageRoot,
      projectId: "video_chain_project",
      title: "Video Chain Project",
      contentType: "video_chain",
    });
    const project = await prisma.project.findUniqueOrThrow({ where: { id: created.project_id } });
    const sourceVideo = await writeSourceVideoFixture({ projectRoot: project.projectRoot });
    await writeFile(path.join(project.projectRoot, "lyrics.md"), "First idea\nSecond card\nThird callout\nFourth proof\n", "utf8");
    await writeFile(path.join(project.projectRoot, "active_music_take.mp3"), Buffer.from("mp3 master"));
    await writeTimingBundle(project.projectRoot);

    const deps = {
      probeSourceVideo: async () => sourceVideo.probe,
      runHtmlVideoAgentRuntime: async (input: { projectDir: string }) => {
        const contracts = JSON.parse(await readFile(path.join(input.projectDir, "qivance-frame-contracts.json"), "utf8"));
        for (const contract of Object.values(contracts.frames) as Array<Record<string, unknown>>) {
          const htmlPath = String(contract.allowedHtmlPath);
          await mkdir(path.dirname(path.join(input.projectDir, htmlPath)), { recursive: true });
          await writeFile(path.join(input.projectDir, htmlPath), frameHtml(contract), "utf8");
        }
        return { agentId: "test", exitCode: 0, stdout: "DONE", stderr: "" };
      },
      renderHtmlVideoVisual: async (input: { outputPath: string }) => {
        await writeFile(input.outputPath, "visual mp4");
      },
      muxLockedAudio: async (input: { finalMp4Path: string }) => {
        await writeFile(input.finalMp4Path, "final mp4");
      },
      ffprobeJson: async (filePath: string) => {
        if (filePath.endsWith("final.mp4")) {
          return { streams: [{ codec_type: "video" }, { codec_type: "audio" }], format: { duration: "4.000" } };
        }
        return { streams: [{ codec_type: "audio" }], format: { duration: "4.000" } };
      },
    };

    await prepareVideoChainContext(project, deps);
    const sourceImport = JSON.parse(await readFile(path.join(project.projectRoot, "data/source/source_video_import.json"), "utf8"));
    assert.equal(sourceImport.audio_policy, "background_video_only");

    const frameResult = await buildVideoChainFrames(project, deps);
    const preview = await loadHtmlVideoPreviewModel(resolveSmallProjectPaths(storageRoot, project.id));
    assert.equal(preview.frames.length, 2);
    assert.equal(frameResult.outputArtifacts.length, 1);
    const agentRunArtifact = frameResult.outputArtifacts[0]!;
    assert.equal(agentRunArtifact.kind, "agent_run");
    assert.equal(agentRunArtifact.schemaVersion, "1");
    assert.match(agentRunArtifact.path, /^video\/html-video\/\.html-video\/projects\/video_chain_project\/agent_runs\/agent_run_.+\.json$/);
    const agentRunLog = JSON.parse(await readFile(path.join(project.projectRoot, agentRunArtifact.path), "utf8"));
    assert.equal(agentRunLog.operation, "run_agent");

    await renderVideoChainVisual(project, deps);
    await muxVideoChainFinal(project, deps);
    await writeVideoChainQaReport(project, deps);
    await writeVideoChainManifest(project, "run_video_test", deps);

    const manifest = JSON.parse(await readFile(path.join(project.projectRoot, "exports/video_chain/render_manifest.json"), "utf8"));
    assert.equal(manifest.schema_version, 6);
    assert.equal(manifest.chain.id, "video_chain");
    assert.equal(manifest.inputs.background_video.audio_policy, "ignore_source_audio");
    assert.equal(manifest.qa.final_audio_source, "active_music_take.mp3");
    assert.equal(manifest.qa.audio_stream_count, 1);
    assert.equal(manifest.production_gates.html_video_agent_required, true);
    assert.equal(manifest.production_gates.fallback_frames_used, false);
  } finally {
    await closeQivancePrismaClient(prisma);
  }
});

async function writeTimingBundle(projectRoot: string): Promise<void> {
  await writeJson(path.join(projectRoot, "data/timing/beat_grid.json"), {
    schema_version: 1,
    duration_sec: 4,
    tempo_bpm: 120,
    tempo_candidates: [120],
    beats: [{ index: 0, time_sec: 0.5, confidence: 1 }],
  });
  await writeJson(path.join(projectRoot, "data/timing/onset_events.json"), {
    schema_version: 1,
    duration_sec: 4,
    events: [{ time_sec: 0.5, strength: 1 }],
  });
  await writeJson(path.join(projectRoot, "data/timing/energy_curve.json"), {
    schema_version: 1,
    duration_sec: 4,
    frame_hop_sec: 0.1,
    points: [{ time_sec: 0, rms: 0.1, normalized_energy: 1 }],
    low_energy_ranges: [],
  });
  await writeJson(path.join(projectRoot, "data/timing/lyric_word_timing.json"), {
    schema_version: 1,
    backend: "whisperx",
    duration_sec: 4,
    words: [
      { word_id: "w_000001", word: "First", text: "First", paragraph_id: "p_001", line_id: "line_001", start_sec: 0.1, end_sec: 0.6 },
      { word_id: "w_000002", word: "idea", text: "idea", paragraph_id: "p_001", line_id: "line_001", start_sec: 0.7, end_sec: 1.0 },
    ],
  });
  await writeJson(path.join(projectRoot, "data/timing/alignment_report.json"), {
    schema_version: 1,
    backend: "whisperx",
    status: "passed",
    metrics: { total_words: 2, aligned_words: 2, low_confidence_words: 0, unmatched_words: 0 },
  });
  await writeJson(path.join(projectRoot, "data/timing/section_map.json"), {
    schema_version: 1,
    duration_sec: 4,
    sections: [
      { section_id: "sec_001", start_sec: 0, end_sec: 2 },
      { section_id: "sec_002", start_sec: 2, end_sec: 4 },
    ],
  });
}

function frameHtml(contract: Record<string, unknown>): string {
  const graphNodeId = String(contract.graphNodeId);
  const sceneId = String(contract.sceneId);
  const durationSec = Number(contract.durationSec);
  return `<!doctype html>
<html>
<body>
  <video src="source_video.mp4" muted autoplay loop playsinline></video>
  <section class="card">Knowledge card</section>
  <script>window.__QIVANCE_FRAME = ${JSON.stringify({ graphNodeId, sceneId, durationSec, durationPolicy: "strict" })};</script>
</body>
</html>`;
}
