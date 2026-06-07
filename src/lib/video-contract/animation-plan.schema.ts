export type QivanceVideoCategory = "ai_concept" | "english_vocab" | "ai_tool_scenario";
export type QivanceAspectRatio = "16:9" | "9:16" | "1:1";
export type CaptionMode = "word_highlight" | "line_caption" | "keyword_burst" | "none";

export type AnimationAsset = {
  id: string;
  type: "image" | "svg" | "video" | "data" | "other";
  path: string;
  role?: string;
};

export type AnimationScene = {
  id: string;
  order: number;
  sectionId: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  frameIntent: string;
  headline: string;
  bodyLines: string[];
  captionMode: CaptionMode;
  visualDirectives: string[];
  beatSync: {
    intensity: number;
    preferredBeatRange?: [number, number];
    hitPointsSec?: number[];
  };
  assets?: AnimationAsset[];
};

export type AnimationPlan = {
  schemaVersion: 1;
  smallProjectId: string;
  title: string;
  category: QivanceVideoCategory;
  targetDurationSec: number;
  fps: number;
  resolution: { width: number; height: number };
  aspectRatio: QivanceAspectRatio;
  mood: string;
  synopsis: string;
  scenes: AnimationScene[];
};

export type ValidationResult = {
  ok: boolean;
  issues: string[];
};

export function validateAnimationPlan(plan: AnimationPlan): ValidationResult {
  const issues: string[] = [];
  if (plan.schemaVersion !== 1) issues.push("schemaVersion must be 1.");
  if (!/^[a-zA-Z0-9_-]+$/.test(plan.smallProjectId)) issues.push("smallProjectId is not stable.");
  if (!Number.isFinite(plan.targetDurationSec) || plan.targetDurationSec <= 0) {
    issues.push("targetDurationSec must be positive.");
  }
  if (!Number.isFinite(plan.fps) || plan.fps <= 0) issues.push("fps must be positive.");
  if (plan.resolution.width <= 0 || plan.resolution.height <= 0) {
    issues.push("resolution width and height must be positive.");
  }
  if (!plan.scenes || plan.scenes.length === 0) issues.push("scenes must not be empty.");

  const seen = new Set<string>();
  const orders = new Set<number>();
  let durationSum = 0;

  for (const scene of plan.scenes ?? []) {
    if (!/^[a-zA-Z0-9_-]+$/.test(scene.id)) issues.push(`scene.id is not stable: ${scene.id}`);
    if (seen.has(scene.id)) issues.push(`scene.id must be unique: ${scene.id}`);
    seen.add(scene.id);
    orders.add(scene.order);
    if (scene.endSec <= scene.startSec) issues.push(`${scene.id}: endSec must be greater than startSec.`);
    if (scene.durationSec < 1) issues.push(`${scene.id}: durationSec must be at least 1.0.`);
    if (Math.abs(scene.durationSec - (scene.endSec - scene.startSec)) > 0.05) {
      issues.push(`${scene.id}: durationSec must match endSec - startSec.`);
    }
    if (scene.beatSync.intensity < 0 || scene.beatSync.intensity > 1) {
      issues.push(`${scene.id}: beatSync.intensity must be between 0 and 1.`);
    }
    durationSum += scene.durationSec;
  }

  for (let order = 0; order < (plan.scenes?.length ?? 0); order += 1) {
    if (!orders.has(order)) issues.push("scene.order must be contiguous.");
  }

  if (Math.abs(durationSum - plan.targetDurationSec) > 0.2) {
    issues.push("scene durations must sum to targetDurationSec.");
  }

  return { ok: issues.length === 0, issues };
}
