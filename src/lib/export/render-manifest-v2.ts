export function buildRenderManifestV2(input: {
  projectId: string;
  aspectRatio: "9:16" | "16:9" | "1:1";
  resolution: { width: number; height: number };
  fps: number;
  workflowRunId: string;
  status: "passed" | "failed";
}) {
  return {
    schema_version: 2,
    project_id: input.projectId,
    aspect_ratio: input.aspectRatio,
    resolution: input.resolution,
    fps: input.fps,
    workflow_run_id: input.workflowRunId,
    status: input.status,
    steps: [],
    inputs: {},
    audio_analysis: {},
    word_alignment: {
      backend: "whisperx",
      metrics: {
        word_coverage: null,
        low_confidence_ratio: null,
        unmatched_ratio: null,
        section_duration_coverage: null,
        section_boundary_evidence_drift_sec: null,
      },
    },
    image_generation: {},
    html_video: {},
    render: { duration_mode: "explicit" },
    mux: {
      source_audio_codec: "mp3",
      final_audio_codec: "aac",
    },
    qa: {},
    diagnostics: [],
  };
}
