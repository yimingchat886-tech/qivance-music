export type MediaE2ERatio = "portrait-9x16" | "landscape-16x9" | "square-1x1";

export type MediaE2EWorkflowOptions = {
  forceAll?: boolean;
  forceStep?: string[];
  skipPreviewSmoke?: boolean;
  requireGpu?: boolean;
  allowCachedImagegen?: boolean;
  allowFallbackFrames?: boolean;
  allowAutoLockImageAssets?: boolean;
  allowCpuWhisperXDiagnostic?: boolean;
  fixtureRatio?: MediaE2ERatio;
  reportPath?: string;
  reviewDecisionPath?: string;
};

export type MediaE2EValidationResult = {
  ok: boolean;
  projectId: string | null;
  issues: string[];
};

export const MEDIA_E2E_RATIO_CONFIG: Record<MediaE2ERatio, {
  aspectRatio: string;
  width: number;
  height: number;
}> = {
  "portrait-9x16": { aspectRatio: "9:16", width: 1080, height: 1920 },
  "landscape-16x9": { aspectRatio: "16:9", width: 1920, height: 1080 },
  "square-1x1": { aspectRatio: "1:1", width: 1080, height: 1080 },
};
