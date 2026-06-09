export const MEDIA_E2E_WORKFLOW_STEPS = [
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
] as const;

export type MediaE2EWorkflowStep = typeof MEDIA_E2E_WORKFLOW_STEPS[number];


export type InjectedMediaE2ESteps = Record<MediaE2EWorkflowStep, () => Promise<unknown>>;

export async function runMediaE2EWorkflowWithInjectedSteps(input: { steps: InjectedMediaE2ESteps }): Promise<void> {
  for (const step of MEDIA_E2E_WORKFLOW_STEPS) {
    await input.steps[step]();
  }
}

export async function runMediaE2EWorkflow(): Promise<void> {
  throw new Error("runMediaE2EWorkflow is implemented task-by-task in PLAN.v2");
}
