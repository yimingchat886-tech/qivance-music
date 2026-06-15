import assert from "node:assert/strict";
import test from "node:test";
import { renderWorkbenchProjectDetailPage } from "../src/lib/workbench/workbench-html.ts";
import { readWorkbenchProjectStatus } from "../src/lib/workbench/project-status.ts";

test("renders V4 scheduler and chat chain summaries on the Workbench project page", async () => {
  const status = await readWorkbenchProjectStatus({
    storageRoot: "projects",
    smallProjectId: "media_e2e_v2_portrait_9x16",
  });

  const html = renderWorkbenchProjectDetailPage({
    status,
    schedulerStatus: {
      schema_version: 1,
      overall_status: "running",
      ready_task_count: 3,
      running_task_count: 1,
      blocked_task_count: 2,
      active_projects: ["media_e2e_v2_portrait_9x16", "parallel_project"],
      active_chains: ["chat_dialogue_mv", "image_storyboard_mv"],
      resource_locks: [
        {
          resource: "chromium_render",
          owner_run_id: "run_001",
          owner_task_id: "task_render_visual",
          project_id: "media_e2e_v2_portrait_9x16",
          chain_id: "chat_dialogue_mv",
          started_at: "2026-06-15T00:00:00.000Z",
          stale_after: "2026-06-15T00:10:00.000Z",
        },
      ],
    },
    chains: [
      {
        chain_id: "chat_dialogue_mv",
        status: "input_ready",
        mode: "production",
        blocking_reasons: [],
        metrics: {
          low_confidence_speaker_count: 1,
          conversation_message_count: 8,
          frame_validation_status: "ready",
        },
        artifacts: {
          conversation_plan: { exists: true, path: "data/chains/chat_dialogue_mv/conversation_plan.json" },
          final_mp4: { exists: false, path: "exports/chat_dialogue_mv/final.mp4" },
        },
      },
    ],
  });

  assert.match(html, /Scheduler/);
  assert.match(html, /Ready tasks/);
  assert.match(html, /media_e2e_v2_portrait_9x16/);
  assert.match(html, /parallel_project/);
  assert.match(html, /chromium_render/);
  assert.match(html, /Chains/);
  assert.match(html, /chat_dialogue_mv/);
  assert.match(html, /low_confidence_speaker_count/);
  assert.match(html, /conversation_message_count/);
  assert.match(html, /frame_validation_status/);
  assert.doesNotMatch(html, /Studio/i);
});
