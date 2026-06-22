import assert from "node:assert/strict";
import test from "node:test";
import {
  renderWorkbenchProjectDetailPage,
  renderWorkbenchProjectsPage,
  renderWorkbenchV5ProjectDetailPage,
  renderWorkbenchV6VideoChainPage,
} from "../src/lib/workbench/workbench-html.ts";
import { readWorkbenchProjectStatus } from "../src/lib/workbench/project-status.ts";

test("renders project list with status summary and project links", () => {
  const html = renderWorkbenchProjectsPage({
    projects: [
      {
        small_project_id: "media_e2e_v2_portrait_9x16",
        mode: "image_music_mode",
        status: "ready",
        project_root: "projects/media_e2e_v2_portrait_9x16",
      },
    ],
  });

  assert.match(html, /Qivance Workbench/);
  assert.match(html, /media_e2e_v2_portrait_9x16/);
  assert.match(html, /image_music_mode/);
  assert.match(html, /\/projects\/media_e2e_v2_portrait_9x16/);
  assert.match(html, /Create V5 Project/);
  assert.match(html, /video_chain/);
  assert.match(html, /\/api\/projects/);
});

test("renders existing V2 fixture project detail with required Workbench sections", async () => {
  const status = await readWorkbenchProjectStatus({
    storageRoot: "projects",
    smallProjectId: "media_e2e_v2_portrait_9x16",
  });
  const html = renderWorkbenchProjectDetailPage({ status });

  for (const label of [
    "Input Diagnostics",
    "Workflow Steps",
    "Animation Plan Approval",
    "Image Schedule",
    "Image Prompt Group",
    "Image Review",
    "Source MP4",
    "Preview",
    "Revision",
    "Agent Runs",
    "Export",
  ]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /const projectId = "media_e2e_v2_portrait_9x16"/);
  assert.match(html, /\/animation-plan\/approve/);
  assert.match(html, /\/source-video\/import/);
  assert.match(html, /\/html-video\/revise/);
  assert.match(html, /location\.reload/);
  assert.doesNotMatch(html, /Studio/i);
});

test("renders V6 video_chain subpage with preview revision and explicit export controls", () => {
  const html = renderWorkbenchV6VideoChainPage({
    detail: {
      schema_version: 1,
      project_id: "project_v6",
      title: "V6 Video Chain",
      description: null,
      content_type: "video_chain",
      status: "passed",
      project_root: "projects/project_v6",
      inputs: [
        {
          id: "input_lyrics",
          kind: "lyrics",
          status: "active",
          original_name: "lyrics.md",
          path: "inputs/lyrics/lyrics.md",
          stable_path: "lyrics.md",
          sha256: "a".repeat(64),
          mime: "text/markdown",
          created_at: "2026-06-16T00:00:00.000Z",
        },
        {
          id: "input_audio",
          kind: "audio",
          status: "active",
          original_name: "take.mp3",
          path: "inputs/audio/take.mp3",
          stable_path: "active_music_take.mp3",
          sha256: "b".repeat(64),
          mime: "audio/mpeg",
          created_at: "2026-06-16T00:00:00.000Z",
        },
        {
          id: "input_video",
          kind: "video",
          status: "active",
          original_name: "background.mp4",
          path: "inputs/video/background.mp4",
          stable_path: "source_video.mp4",
          sha256: "c".repeat(64),
          mime: "video/mp4",
          created_at: "2026-06-16T00:00:00.000Z",
        },
      ],
      chains: [],
      artifacts: [
        {
          id: "artifact_frames",
          chain_id: "video_chain",
          kind: "frame_contracts",
          path: "data/chains/video_chain/frame_contracts.json",
          sha256: "d".repeat(64),
          schema_version: "1",
          status: "current",
          created_by_run_id: "run_v6",
          created_at: "2026-06-16T00:00:00.000Z",
        },
        {
          id: "artifact_final",
          chain_id: "video_chain",
          kind: "final",
          path: "exports/video_chain/final.mp4",
          sha256: "e".repeat(64),
          schema_version: null,
          status: "current",
          created_by_run_id: "run_v6",
          created_at: "2026-06-16T00:00:00.000Z",
        },
      ],
      runs: [],
    },
  });

  assert.match(html, /V6 Video Chain/);
  assert.match(html, /name="video_file"/);
  assert.match(html, /\/projects\/project_v6\/video-chain\/preview/);
  assert.match(html, /\/chains\/video-chain\/revise/);
  assert.match(html, /\/chains\/video-chain\/export\/render/);
  assert.match(html, /preview_refreshed/);
  assert.match(html, /\/chains\/video-chain\/export\/final\.mp4/);
});

test("renders stale V6 final export without current download delivery", () => {
  const html = renderWorkbenchV6VideoChainPage({
    detail: {
      schema_version: 1,
      project_id: "project_v6_stale",
      title: "V6 Video Chain Stale",
      description: null,
      content_type: "video_chain",
      status: "ready",
      project_root: "projects/project_v6_stale",
      inputs: [],
      chains: [],
      artifacts: [
        {
          id: "artifact_frames",
          chain_id: "video_chain",
          kind: "frame_contracts",
          path: "data/chains/video_chain/frame_contracts.json",
          sha256: "d".repeat(64),
          schema_version: "1",
          status: "current",
          created_by_run_id: "run_preview",
          created_at: "2026-06-16T00:00:00.000Z",
        },
        {
          id: "artifact_final",
          chain_id: "video_chain",
          kind: "final",
          path: "exports/video_chain/final.mp4",
          sha256: "e".repeat(64),
          schema_version: null,
          status: "stale",
          created_by_run_id: "run_export",
          created_at: "2026-06-16T00:00:00.000Z",
        },
      ],
      runs: [],
    },
  });

  assert.match(html, /Final export[\s\S]*stale/);
  assert.match(html, /<button disabled>Download final MP4<\/button>/);
  assert.doesNotMatch(html, /\/chains\/video-chain\/export\/final\.mp4/);
});

test("renders V5 product-entry controls and scheduler progress", () => {
  const html = renderWorkbenchV5ProjectDetailPage({
    detail: {
      schema_version: 1,
      project_id: "project_v5",
      title: "V5 Product Entry",
      description: null,
      content_type: "chat_dialogue_mv",
      status: "queued",
      project_root: "projects/project_v5",
      inputs: [
        {
          id: "input_lyrics",
          kind: "lyrics",
          status: "active",
          original_name: "lyrics.md",
          path: "inputs/lyrics/lyrics.md",
          stable_path: "lyrics.md",
          sha256: "a".repeat(64),
          mime: "text/markdown",
          created_at: "2026-06-15T00:00:00.000Z",
        },
        {
          id: "input_audio",
          kind: "audio",
          status: "active",
          original_name: "take.mp3",
          path: "inputs/audio/take.mp3",
          stable_path: "active_music_take.mp3",
          sha256: "b".repeat(64),
          mime: "audio/mpeg",
          created_at: "2026-06-15T00:00:00.000Z",
        },
      ],
      chains: [],
      artifacts: [
        {
          id: "artifact_manifest",
          chain_id: "chat_dialogue_mv",
          kind: "render_manifest",
          path: "exports/chat_dialogue_mv/render_manifest.json",
          sha256: "c".repeat(64),
          schema_version: "4",
          status: "current",
          created_by_run_id: "run_v5",
          created_at: "2026-06-15T00:00:00.000Z",
        },
      ],
      runs: [
        {
          id: "run_v5",
          status: "queued",
          mode: "production",
          priority: 50,
          stop_requested: false,
          created_at: "2026-06-15T00:00:00.000Z",
          updated_at: "2026-06-15T00:00:00.000Z",
          tasks: [
            {
              id: "run_v5_run_timing_pipeline",
              chain_id: "chat_dialogue_mv",
              stage: "run_timing_pipeline",
              status: "queued",
              last_error: null,
              started_at: null,
              finished_at: null,
            },
          ],
          events: [
            {
              id: "event_v5",
              task_id: null,
              event_type: "run_created",
              message: "V5 scheduler run created from confirmed inputs.",
              details_json: null,
              created_at: "2026-06-15T00:00:00.000Z",
            },
          ],
        },
      ],
    },
  });

  assert.match(html, /V5 Product Entry/);
  assert.match(html, /data-action="v5-input-upload"/);
  assert.match(html, /data-action="v5-confirm-inputs"/);
  assert.match(html, /data-action="v5-stop-run"/);
  assert.match(html, /run_timing_pipeline/);
  assert.match(html, /render_manifest/);
  assert.match(html, /run_created/);
  assert.match(html, /\/inputs\/confirm/);
  assert.match(html, /\/runs\/"\s*\+/);
  assert.doesNotMatch(html, /Studio/i);
});
