import test from "node:test";
import assert from "node:assert/strict";
import {
  MEDIA_E2E_WORKFLOW_STEPS,
  runMediaE2EWorkflowWithInjectedSteps,
  validateMediaE2EProductionGates,
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

test("production gates fail cached imagegen and fallback frames by default", () => {
  const gate = validateMediaE2EProductionGates({
    cachedImagegenRequests: ["img_req_scene_001"],
    fallbackFramePaths: ["frames/01-scene.html"],
    htmlVideoRuntimeExitCode: 124,
  });

  assert.equal(gate.ok, false);
  assert.match(gate.issues.join("\n"), /cached imagegen/);
  assert.match(gate.issues.join("\n"), /fallback frame/);
  assert.match(gate.issues.join("\n"), /clean runtime exit/);
});

test("production gates defer AI-authored frame requirement until runtime has executed", () => {
  const gate = validateMediaE2EProductionGates({
    cachedImagegenRequests: [],
    fallbackFramePaths: [],
    htmlVideoRuntimeExitCode: null,
  });

  assert.equal(gate.ok, true);
});

test("production gates allow diagnostic cached imagegen and fallback frames only with flags", () => {
  const gate = validateMediaE2EProductionGates({
    cachedImagegenRequests: ["img_req_scene_001"],
    fallbackFramePaths: ["frames/01-scene.html"],
    htmlVideoRuntimeExitCode: 124,
    allowCachedImagegen: true,
    allowFallbackFrames: true,
  });

  assert.equal(gate.ok, true);
});
