export const V5_CHAIN_IDS = ["chat_dialogue_mv", "video_chain"] as const;

export type V5ChainId = (typeof V5_CHAIN_IDS)[number];

export type V5ChainInputKind = "lyrics" | "audio" | "video";

export type V5ChainStage =
  | "run_timing_pipeline"
  | "build_lyrics_line_map"
  | "build_speaker_attribution"
  | "build_conversation_plan"
  | "build_chat_frames"
  | "render_visual"
  | "mux_final"
  | "qa_report"
  | "write_manifest"
  | "prepare_video_context"
  | "build_video_frames"
  | "render_video_visual"
  | "mux_video_final"
  | "video_qa_report"
  | "write_video_manifest";

export type V5ChainResource =
  | "audio_analysis"
  | "whisperx_alignment"
  | "html_video_agent"
  | "chromium_render"
  | "ffmpeg_mux"
  | "image_generation";

export type V5ChainRegistryEntry = {
  chain_id: V5ChainId;
  display_name: string;
  enabled: boolean;
  input_requirements: V5ChainInputKind[];
  required_timing: boolean;
  stages: V5ChainStage[];
  resources_by_stage: Record<V5ChainStage, V5ChainResource[]>;
  output_artifacts: string[];
};

export type V5SchedulerTaskSeed = {
  stage: V5ChainStage;
  dependencies: V5ChainStage[];
  resource_requirements: V5ChainResource[];
  output_artifacts: string[];
};

export type V5SchedulerTaskPhase = "preview" | "export";

export type V5SchedulerTaskSeedOptions = {
  phase?: V5SchedulerTaskPhase;
};

export const CHAT_DIALOGUE_MV_CHAIN: V5ChainRegistryEntry = {
  chain_id: "chat_dialogue_mv",
  display_name: "Chat Dialogue MV",
  enabled: true,
  input_requirements: ["lyrics", "audio"],
  required_timing: true,
  stages: [
    "run_timing_pipeline",
    "build_lyrics_line_map",
    "build_speaker_attribution",
    "build_conversation_plan",
    "build_chat_frames",
    "render_visual",
    "mux_final",
    "qa_report",
    "write_manifest",
  ],
  resources_by_stage: {
    run_timing_pipeline: ["audio_analysis", "whisperx_alignment"],
    build_lyrics_line_map: [],
    build_speaker_attribution: [],
    build_conversation_plan: [],
    build_chat_frames: ["html_video_agent"],
    render_visual: ["chromium_render"],
    mux_final: ["ffmpeg_mux"],
    qa_report: [],
    write_manifest: [],
    prepare_video_context: [],
    build_video_frames: [],
    render_video_visual: [],
    mux_video_final: [],
    video_qa_report: [],
    write_video_manifest: [],
  },
  output_artifacts: [
    "exports/chat_dialogue_mv/final.mp4",
    "exports/chat_dialogue_mv/render_manifest.json",
  ],
};

export const VIDEO_CHAIN: V5ChainRegistryEntry = {
  chain_id: "video_chain",
  display_name: "Video Chain",
  enabled: true,
  input_requirements: ["lyrics", "audio", "video"],
  required_timing: true,
  stages: [
    "run_timing_pipeline",
    "prepare_video_context",
    "build_video_frames",
    "render_video_visual",
    "mux_video_final",
    "video_qa_report",
    "write_video_manifest",
  ],
  resources_by_stage: {
    run_timing_pipeline: ["audio_analysis", "whisperx_alignment"],
    prepare_video_context: [],
    build_video_frames: ["html_video_agent"],
    render_video_visual: ["chromium_render"],
    mux_video_final: ["ffmpeg_mux"],
    video_qa_report: [],
    write_video_manifest: [],
    build_lyrics_line_map: [],
    build_speaker_attribution: [],
    build_conversation_plan: [],
    build_chat_frames: [],
    render_visual: [],
    mux_final: [],
    qa_report: [],
    write_manifest: [],
  },
  output_artifacts: [
    "exports/video_chain/final.mp4",
    "exports/video_chain/render_manifest.json",
  ],
};

const REGISTRY = new Map<string, V5ChainRegistryEntry>([
  [CHAT_DIALOGUE_MV_CHAIN.chain_id, CHAT_DIALOGUE_MV_CHAIN],
  [VIDEO_CHAIN.chain_id, VIDEO_CHAIN],
]);

export function listEnabledV5Chains(): V5ChainRegistryEntry[] {
  return [...REGISTRY.values()].filter((entry) => entry.enabled);
}

export function readV5ChainRegistryEntry(chainId: string): V5ChainRegistryEntry | null {
  return REGISTRY.get(chainId) ?? null;
}

export function requireEnabledV5Chain(chainId: string): V5ChainRegistryEntry {
  const entry = readV5ChainRegistryEntry(chainId);
  if (!entry || !entry.enabled) {
    throw new Error(`Unsupported V5 chain: ${chainId}`);
  }
  return entry;
}

export function buildV5SchedulerTaskSeeds(chainId: string, options: V5SchedulerTaskSeedOptions = {}): V5SchedulerTaskSeed[] {
  const entry = requireEnabledV5Chain(chainId);
  const stages = stagesForTaskSeeds(entry, options);
  return stages.map((stage, index) => ({
    stage,
    dependencies: index === 0 ? [] : [stages[index - 1]!],
    resource_requirements: entry.resources_by_stage[stage],
    output_artifacts: outputArtifactsForStage(entry.chain_id, stage),
  }));
}

function stagesForTaskSeeds(entry: V5ChainRegistryEntry, options: V5SchedulerTaskSeedOptions): V5ChainStage[] {
  if (entry.chain_id !== "video_chain") return entry.stages;
  if (options.phase === "export") {
    return [
      "render_video_visual",
      "mux_video_final",
      "video_qa_report",
      "write_video_manifest",
    ];
  }
  return [
    "run_timing_pipeline",
    "prepare_video_context",
    "build_video_frames",
  ];
}

function outputArtifactsForStage(chainId: V5ChainId, stage: V5ChainStage): string[] {
  if (chainId === "video_chain") {
    switch (stage) {
      case "run_timing_pipeline":
        return [
          "data/timing/beat_grid.json",
          "data/timing/onset_events.json",
          "data/timing/energy_curve.json",
          "data/timing/lyric_word_timing.json",
          "data/timing/alignment_report.json",
          "data/timing/section_map.json",
        ];
      case "prepare_video_context":
        return [
          "data/source/source_video_import.json",
          "data/chains/video_chain/video_animation_plan.json",
        ];
      case "build_video_frames":
        return [
          "data/chains/video_chain/frame_contracts.json",
          "video/html-video/.html-video/projects/<project_id>/agent_runs/<agent_run_id>.json",
        ];
      case "render_video_visual":
        return ["exports/video_chain/visual.mp4"];
      case "mux_video_final":
        return ["exports/video_chain/final.mp4"];
      case "video_qa_report":
        return ["data/chains/video_chain/qa_report.json"];
      case "write_video_manifest":
        return ["exports/video_chain/render_manifest.json"];
      default:
        return [];
    }
  }

  switch (stage) {
    case "run_timing_pipeline":
      return [
        "data/timing/beat_grid.json",
        "data/timing/onset_events.json",
        "data/timing/energy_curve.json",
        "data/timing/lyric_word_timing.json",
        "data/timing/alignment_report.json",
        "data/timing/section_map.json",
      ];
    case "build_lyrics_line_map":
      return ["data/chains/chat_dialogue_mv/lyrics_line_map.json"];
    case "build_speaker_attribution":
      return ["data/chains/chat_dialogue_mv/speaker_attribution.json"];
    case "build_conversation_plan":
      return ["data/chains/chat_dialogue_mv/conversation_plan.json"];
    case "build_chat_frames":
      return [
        "data/chains/chat_dialogue_mv/animation_plan.json",
        "data/chains/chat_dialogue_mv/frame_contracts.json",
      ];
    case "render_visual":
      return ["exports/chat_dialogue_mv/visual.mp4"];
    case "mux_final":
      return ["exports/chat_dialogue_mv/final.mp4"];
    case "qa_report":
      return ["data/chains/chat_dialogue_mv/qa_report.json"];
    case "write_manifest":
      return ["exports/chat_dialogue_mv/render_manifest.json"];
    default:
      return [];
  }
}
