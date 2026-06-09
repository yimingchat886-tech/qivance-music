import test from "node:test";
import assert from "node:assert/strict";
import {
  MEDIA_E2E_WORKFLOW_STEPS,
  runMediaE2EWorkflowWithInjectedSteps,
  type InjectedMediaE2ESteps,
} from "../src/lib/media-e2e/workflow.ts";

test("V2 workflow order matches the SPEC", () => {
  assert.deepEqual(MEDIA_E2E_WORKFLOW_STEPS, [
    "validate_fixture_bundle",
    "analyze_audio_with_librosa",
    "align_words_with_whisperx",
    "build_section_map",
    "generate_background_images",
    "review_and_lock_image_assets",
    "write_html_video_workspace",
    "run_html_video_agent_runtime",
    "validate_frame_outputs",
    "static_preview_smoke",
    "render_visual_with_html_video",
    "mux_active_mp3_to_final_aac",
    "ffprobe_visual_and_final",
    "write_render_manifest",
    "append_test_report_evidence",
  ]);
});


test("runs injected workflow steps in order", async () => {
  const calls: string[] = [];
  const steps = Object.fromEntries(
    MEDIA_E2E_WORKFLOW_STEPS.map((step) => [step, async () => {
      calls.push(step);
    }]),
  ) as InjectedMediaE2ESteps;

  await runMediaE2EWorkflowWithInjectedSteps({ steps });

  assert.deepEqual(calls, [...MEDIA_E2E_WORKFLOW_STEPS]);
});
