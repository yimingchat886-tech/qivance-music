import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ImageScheduleStatus = "draft" | "confirmed" | "generating" | "reviewing" | "complete" | "blocked";
export type ImageScheduleItemStatus = "prompt_pending" | "prompt_confirmed" | "generating" | "reviewing" | "locked" | "skipped";
export type ImageScheduleAspectRatio = "9:16" | "16:9" | "1:1";

export type ImageGenerationScheduleItem = {
  image_id: string;
  scene_id: string;
  section_ids: string[];
  start_sec: number;
  end_sec: number;
  asset_role: "background";
  aspect_ratio: ImageScheduleAspectRatio;
  target_size: { width: number; height: number };
  recommendation_reason: string;
  status: ImageScheduleItemStatus;
  skip: boolean;
  reusable_asset_id?: string;
  requires_prompt?: boolean;
  requires_generation?: boolean;
};

export type ImageGenerationSchedule = {
  schema_version: 1;
  small_project_id: string;
  source_section_map_sha256: string;
  status: ImageScheduleStatus;
  generated_at: string;
  items: ImageGenerationScheduleItem[];
  manual_overrides: unknown[];
};

export type ImageScheduleValidationResult = {
  ok: boolean;
  issues: string[];
};

export type LockedReusableImageAsset = {
  asset_id: string;
  scene_id: string;
  role?: string;
  status?: string;
};

type SectionForSchedule = {
  sceneId: string;
  sectionIds: string[];
  startSec: number;
  endSec: number;
  durationSec: number;
  visualChangeDensity: number | null;
  reusableAssetId: string | null;
};

const TARGET_SIZE_BY_ASPECT_RATIO: Record<ImageScheduleAspectRatio, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
};

const ALLOWED_SCHEDULE_STATUSES: readonly ImageScheduleStatus[] = ["draft", "confirmed", "generating", "reviewing", "complete", "blocked"];
const ALLOWED_ITEM_STATUSES: readonly ImageScheduleItemStatus[] = ["prompt_pending", "prompt_confirmed", "generating", "reviewing", "locked", "skipped"];

export async function readSectionMapForImageSchedule(projectRoot: string): Promise<{ sectionMap: unknown; path: string; sha256: string }> {
  for (const relativePath of ["data/storyboard/section_map.json", "timing/section_map.json"]) {
    const absolutePath = path.join(projectRoot, relativePath);
    try {
      const raw = await readFile(absolutePath, "utf8");
      return {
        sectionMap: JSON.parse(raw),
        path: normalizePath(relativePath),
        sha256: sha256Text(raw),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error("section_map.json was not found in data/storyboard or timing.");
}

export function recommendImageGenerationSchedule(input: {
  smallProjectId: string;
  sectionMap: unknown;
  sourceSectionMapSha256: string;
  aspectRatio?: ImageScheduleAspectRatio;
  targetSize?: { width: number; height: number };
  generatedAt?: string;
  reusableAssets?: LockedReusableImageAsset[];
}): ImageGenerationSchedule {
  const aspectRatio = input.aspectRatio ?? "9:16";
  const targetSize = input.targetSize ?? targetSizeForAspectRatio(aspectRatio);
  const reusableAssets = lockedBackgroundAssetMap(input.reusableAssets ?? []);
  const sections = sectionMapSections(input.sectionMap, reusableAssets);
  return {
    schema_version: 1,
    small_project_id: input.smallProjectId,
    source_section_map_sha256: input.sourceSectionMapSha256,
    status: "draft",
    generated_at: input.generatedAt ?? new Date().toISOString(),
    items: sections.flatMap((section) => recommendedItemsForSection(section, aspectRatio, targetSize)),
    manual_overrides: [],
  };
}

export async function writeRecommendedImageGenerationSchedule(input: {
  projectRoot: string;
  smallProjectId: string;
  aspectRatio?: ImageScheduleAspectRatio;
  targetSize?: { width: number; height: number };
  generatedAt?: string;
  reusableAssets?: LockedReusableImageAsset[];
}): Promise<{ schedule: ImageGenerationSchedule; path: string }> {
  const sectionMap = await readSectionMapForImageSchedule(input.projectRoot);
  const schedule = recommendImageGenerationSchedule({
    smallProjectId: input.smallProjectId,
    sectionMap: sectionMap.sectionMap,
    sourceSectionMapSha256: sectionMap.sha256,
    aspectRatio: input.aspectRatio,
    targetSize: input.targetSize,
    generatedAt: input.generatedAt,
    reusableAssets: input.reusableAssets,
  });
  const relativePath = "data/storyboard/image_generation_schedule.json";
  await writeJson(path.join(input.projectRoot, relativePath), schedule);
  return { schedule, path: relativePath };
}

export function validateImageGenerationSchedule(input: {
  schedule: unknown;
  sectionMap: unknown;
  smallProjectId: string;
}): ImageScheduleValidationResult {
  const issues: string[] = [];
  const schedule = isRecord(input.schedule) ? input.schedule : null;
  if (!schedule) return { ok: false, issues: ["image generation schedule must be a JSON object"] };

  if (schedule.schema_version !== 1) issues.push("image generation schedule schema_version must be 1");
  if (schedule.small_project_id !== input.smallProjectId) {
    issues.push(`image generation schedule small_project_id must be ${input.smallProjectId}`);
  }
  if (!ALLOWED_SCHEDULE_STATUSES.includes(schedule.status as ImageScheduleStatus)) {
    issues.push("image generation schedule status must be draft, confirmed, generating, reviewing, complete, or blocked");
  }
  if (typeof schedule.source_section_map_sha256 !== "string" || schedule.source_section_map_sha256.length === 0) {
    issues.push("image generation schedule source_section_map_sha256 is required");
  }
  if (!Array.isArray(schedule.items)) {
    issues.push("image generation schedule items must be an array");
    return { ok: false, issues };
  }

  const sections = sectionMapSections(input.sectionMap, new Map());
  const sectionsByScene = new Map(sections.map((section) => [section.sceneId, section]));
  const sectionIdSet = new Set(sections.flatMap((section) => section.sectionIds));
  const seenImageIds = new Set<string>();

  for (const [index, rawItem] of schedule.items.entries()) {
    const label = `items[${index}]`;
    if (!isRecord(rawItem)) {
      issues.push(`${label} must be an object`);
      continue;
    }
    const imageId = stringField(rawItem.image_id);
    const sceneId = stringField(rawItem.scene_id);
    if (!imageId) {
      issues.push(`${label}.image_id is required`);
    } else if (seenImageIds.has(imageId)) {
      issues.push(`${label}.image_id duplicates ${imageId}`);
    } else {
      seenImageIds.add(imageId);
    }

    const scene = sceneId ? sectionsByScene.get(sceneId) : null;
    if (!sceneId) {
      issues.push(`${label}.scene_id is required`);
    } else if (!scene) {
      issues.push(`${label}.scene_id references unknown scene ${sceneId}`);
    }

    const sectionIds = stringArray(rawItem.section_ids);
    if (sectionIds.length === 0) {
      issues.push(`${label}.section_ids must contain at least one section id`);
    }
    for (const sectionId of sectionIds) {
      if (!sectionIdSet.has(sectionId)) issues.push(`${label}.section_ids references unknown section ${sectionId}`);
    }

    const startSec = finiteNumber(rawItem.start_sec);
    const endSec = finiteNumber(rawItem.end_sec);
    if (startSec === null) issues.push(`${label}.start_sec must be a finite number`);
    if (endSec === null) issues.push(`${label}.end_sec must be a finite number`);
    if (startSec !== null && endSec !== null) {
      if (endSec <= startSec) issues.push(`${label}.end_sec must be greater than start_sec`);
      if (scene && (startSec < scene.startSec || endSec > scene.endSec)) {
        issues.push(`${label}.time range must stay inside scene ${scene.sceneId}`);
      }
    }

    if (rawItem.asset_role !== "background") issues.push(`${label}.asset_role must be background`);
    const aspectRatio = aspectRatioValue(rawItem.aspect_ratio);
    if (!aspectRatio) {
      issues.push(`${label}.aspect_ratio must be 9:16, 16:9, or 1:1`);
    }
    if (!isTargetSize(rawItem.target_size)) {
      issues.push(`${label}.target_size must include positive integer width and height`);
    } else if (aspectRatio && !targetSizeMatchesAspectRatio(rawItem.target_size, aspectRatio)) {
      issues.push(`${label}.target_size must match aspect_ratio ${aspectRatio}`);
    }

    const status = rawItem.status;
    if (!ALLOWED_ITEM_STATUSES.includes(status as ImageScheduleItemStatus)) {
      issues.push(`${label}.status must be prompt_pending, prompt_confirmed, generating, reviewing, locked, or skipped`);
    }
    const skip = rawItem.skip === true;
    if (typeof rawItem.skip !== "boolean") issues.push(`${label}.skip must be boolean`);
    if (skip) {
      if (status !== "skipped") issues.push(`${label}.status must be skipped when skip is true`);
      if (rawItem.requires_prompt === true || status === "prompt_pending" || status === "prompt_confirmed") {
        issues.push(`${label} is skipped and cannot require a prompt`);
      }
      if (rawItem.requires_generation === true || status === "generating" || status === "reviewing") {
        issues.push(`${label} is skipped and cannot require generation`);
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

export function targetSizeForAspectRatio(aspectRatio: ImageScheduleAspectRatio): { width: number; height: number } {
  return { ...TARGET_SIZE_BY_ASPECT_RATIO[aspectRatio] };
}

function recommendedItemsForSection(
  section: SectionForSchedule,
  aspectRatio: ImageScheduleAspectRatio,
  targetSize: { width: number; height: number },
): ImageGenerationScheduleItem[] {
  const count = recommendedImageCount(section);
  return Array.from({ length: count }, (_, index) => {
    const range = itemTimeRange(section, count, index);
    const reusableAssetId = index === 0 ? section.reusableAssetId : null;
    const status: ImageScheduleItemStatus = reusableAssetId ? "locked" : "prompt_pending";
    return {
      image_id: `img_${safeId(section.sceneId)}_${String(index + 1).padStart(3, "0")}`,
      scene_id: section.sceneId,
      section_ids: section.sectionIds,
      start_sec: range.startSec,
      end_sec: range.endSec,
      asset_role: "background",
      aspect_ratio: aspectRatio,
      target_size: { ...targetSize },
      recommendation_reason: recommendationReason(section, reusableAssetId, count),
      status,
      skip: false,
      ...(reusableAssetId ? { reusable_asset_id: reusableAssetId, requires_prompt: false, requires_generation: false } : {}),
    };
  });
}

function recommendedImageCount(section: SectionForSchedule): number {
  if (section.reusableAssetId) return 1;
  if (section.durationSec >= 14) return 2;
  if ((section.visualChangeDensity ?? 0) >= 0.75 && section.durationSec >= 8) return 2;
  return 1;
}

function recommendationReason(section: SectionForSchedule, reusableAssetId: string | null, count: number): string {
  if (reusableAssetId) return "Existing locked background asset can be reused for this scene.";
  if (count > 1) return "Scene duration or visual change density benefits from multiple background images.";
  if ((section.visualChangeDensity ?? 0) > 0) return "Scene visual change density supports one background image.";
  return "Scene duration supports one background image.";
}

function itemTimeRange(section: SectionForSchedule, count: number, index: number): { startSec: number; endSec: number } {
  if (count === 1) return { startSec: section.startSec, endSec: section.endSec };
  const duration = (section.endSec - section.startSec) / count;
  return {
    startSec: round(section.startSec + duration * index),
    endSec: round(index === count - 1 ? section.endSec : section.startSec + duration * (index + 1)),
  };
}

function sectionMapSections(sectionMap: unknown, reusableAssets: Map<string, string>): SectionForSchedule[] {
  const root = isRecord(sectionMap) ? sectionMap : null;
  if (!root || !Array.isArray(root.sections)) throw new Error("section_map.sections must be an array");
  return root.sections.map((rawSection, index) => sectionForSchedule(rawSection, index, reusableAssets));
}

function sectionForSchedule(rawSection: unknown, index: number, reusableAssets: Map<string, string>): SectionForSchedule {
  if (!isRecord(rawSection)) throw new Error(`section_map.sections[${index}] must be an object`);
  const sectionId = stringField(rawSection.section_id) ?? stringField(rawSection.id);
  const sceneId = stringField(rawSection.scene_id) ?? sectionId;
  if (!sceneId || !sectionId) throw new Error(`section_map.sections[${index}] must include section_id`);
  const startSec = finiteNumber(rawSection.start_sec) ?? finiteNumber(rawSection.startSec);
  const endSec = finiteNumber(rawSection.end_sec) ?? finiteNumber(rawSection.endSec);
  if (startSec === null || endSec === null || endSec <= startSec) {
    throw new Error(`section_map.sections[${index}] must include a valid start/end range`);
  }
  const sectionIds = stringArray(rawSection.section_ids);
  const visualChangeDensity = finiteNumber(rawSection.visual_change_density)
    ?? finiteNumber(rawSection.visualChangeDensity)
    ?? finiteNumber(rawSection.visual_change_density_score)
    ?? (isRecord(rawSection.evidence) && rawSection.evidence.energy_boundary_hint === true ? 0.75 : null);
  return {
    sceneId,
    sectionIds: sectionIds.length > 0 ? sectionIds : [sectionId],
    startSec,
    endSec,
    durationSec: round(endSec - startSec),
    visualChangeDensity,
    reusableAssetId: reusableAssets.get(sceneId) ?? reusableAssets.get(sectionId) ?? null,
  };
}

function lockedBackgroundAssetMap(assets: LockedReusableImageAsset[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const asset of assets) {
    if (asset.status && asset.status !== "locked") continue;
    if (asset.role && asset.role !== "background") continue;
    if (asset.scene_id && asset.asset_id) map.set(asset.scene_id, asset.asset_id);
  }
  return map;
}

function targetSizeMatchesAspectRatio(targetSize: { width: number; height: number }, aspectRatio: ImageScheduleAspectRatio): boolean {
  const expected = TARGET_SIZE_BY_ASPECT_RATIO[aspectRatio];
  return targetSize.width === expected.width && targetSize.height === expected.height;
}

function isTargetSize(value: unknown): value is { width: number; height: number } {
  if (!isRecord(value)) return false;
  return isPositiveInteger(value.width) && isPositiveInteger(value.height);
}

function aspectRatioValue(value: unknown): ImageScheduleAspectRatio | null {
  return value === "9:16" || value === "16:9" || value === "1:1" ? value : null;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeId(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_]+/g, "_").replaceAll(/^_+|_+$/g, "");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizePath(value: string): string {
  return value.replaceAll(path.sep, "/");
}
