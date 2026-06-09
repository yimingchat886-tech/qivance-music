import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  MEDIA_E2E_RATIO_CONFIG,
  type MediaE2ERatio,
  type MediaE2EValidationResult,
} from "./types.ts";

const REQUIRED_FIXTURE_FILES = [
  "active_music_take.mp3",
  "lyrics.md",
  "animation_plan.json",
  "image_generation_plan.json",
] as const;

export async function validateMediaE2EFixtureBundle(input: {
  bundlePath: string;
  ratio: MediaE2ERatio;
}): Promise<MediaE2EValidationResult> {
  const issues: string[] = [];

  for (const file of REQUIRED_FIXTURE_FILES) {
    try {
      await access(path.join(input.bundlePath, file));
    } catch {
      issues.push(`missing required fixture file: ${file}`);
    }
  }

  const animationPlan = await readJson(path.join(input.bundlePath, "animation_plan.json"), issues);
  const imageGenerationPlan = await readJson(path.join(input.bundlePath, "image_generation_plan.json"), issues);
  const ratioConfig = MEDIA_E2E_RATIO_CONFIG[input.ratio];
  const projectId = stringValue(animationPlan?.small_project_id);

  if (animationPlan) {
    if (animationPlan.aspect_ratio !== ratioConfig.aspectRatio) {
      issues.push(`animation_plan.aspect_ratio must be ${ratioConfig.aspectRatio}`);
    }
    if (
      animationPlan.resolution?.width !== ratioConfig.width ||
      animationPlan.resolution?.height !== ratioConfig.height
    ) {
      issues.push(`animation_plan.resolution must be ${ratioConfig.width}x${ratioConfig.height}`);
    }

    const scenes = Array.isArray(animationPlan.scenes) ? animationPlan.scenes : [];
    if (scenes.length < 3) {
      issues.push("animation_plan.scenes must contain at least 3 scenes");
    }
    if (!scenes.some((scene) => scene?.image_generation?.enabled === true)) {
      issues.push("at least one scene must set image_generation.enabled = true");
    }
  }

  if (imageGenerationPlan) {
    const requests = Array.isArray(imageGenerationPlan.requests) ? imageGenerationPlan.requests : [];
    if (requests.length < 1) {
      issues.push("image_generation_plan.requests must contain at least one request");
    }
  }

  return {
    ok: issues.length === 0,
    projectId,
    issues,
  };
}

async function readJson(filePath: string, issues: string[]): Promise<Record<string, any> | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Record<string, any>;
  } catch {
    issues.push(`invalid json: ${filePath}`);
    return null;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
