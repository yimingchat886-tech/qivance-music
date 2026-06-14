import type { SmallProjectPaths } from "../project-core/paths.ts";
import type { AnimationPlan } from "./animation-plan.schema.ts";
import { sourceVideoAgentContext, type SourceVideoImportFile } from "../video-html/source-video-import.ts";

export type AgentContextSourceVideo =
  | { enabled: false }
  | ReturnType<typeof sourceVideoAgentContext>;

export type AgentContext = {
  schemaVersion: 1;
  mode: "html_video_frame_author";
  smallProjectId: string;
  videoType: "rap_teaching_short";
  durationPolicy: "strict";
  targetDurationSec: number;
  fps: number;
  resolution: { width: number; height: number };
  contentGraphPath: string;
  frameContractsPath: string;
  sourceFiles: {
    animationPlan: string;
    sectionMap: string;
    beatGrid: string;
    lyricWordTiming: string;
    masterAudio: string;
  };
  sourceVideo: AgentContextSourceVideo;
  allowedWritePaths: string[];
  forbiddenWritePaths: string[];
  instructions: {
    generateMissingFrames: boolean;
    optimizeExistingFrames: boolean;
    noAudioAuthoring: true;
    noDurationExtension: true;
    noNetworkAssets: true;
    preferInlineCssAndJs: true;
  };
};

export function buildAgentContext(input: {
  plan: AnimationPlan;
  paths: SmallProjectPaths;
  sourceVideoImport?: SourceVideoImportFile;
}): AgentContext {
  return {
    schemaVersion: 1,
    mode: "html_video_frame_author",
    smallProjectId: input.plan.smallProjectId,
    videoType: "rap_teaching_short",
    durationPolicy: "strict",
    targetDurationSec: input.plan.targetDurationSec,
    fps: input.plan.fps,
    resolution: input.plan.resolution,
    contentGraphPath: "content-graph.json",
    frameContractsPath: "qivance-frame-contracts.json",
    sourceFiles: {
      animationPlan: "../../../qivance/animation_plan.json",
      sectionMap: "../../../timing/section_map.json",
      beatGrid: "../../../timing/beat_grid.json",
      lyricWordTiming: "../../../timing/lyric_word_timing.json",
      masterAudio: "../../../audio/master/active_music_take.wav",
    },
    sourceVideo: input.sourceVideoImport ? sourceVideoAgentContext(input.sourceVideoImport) : { enabled: false },
    allowedWritePaths: ["frames/**/*.html", "codex/**", "qa/**"],
    forbiddenWritePaths: [
      "project.json",
      "content-graph.json",
      "qivance-frame-contracts.json",
      "../../../qivance/**",
      "../../../timing/**",
      "../../../audio/**",
      "../**",
      "../../**",
    ],
    instructions: {
      generateMissingFrames: true,
      optimizeExistingFrames: true,
      noAudioAuthoring: true,
      noDurationExtension: true,
      noNetworkAssets: true,
      preferInlineCssAndJs: true,
    },
  };
}
