import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImageGenerationSchedule } from "./image-schedule.ts";

export type ImagePromptGroupStatus = "draft" | "confirmation_required" | "confirmed";

export type ImagePromptStyle = {
  style_id: string;
  label: string;
  style_prompt: string;
  source: "preset";
};

export type ImagePromptGroupItem = {
  image_id: string;
  scene_id: string;
  scene_prompt: string;
  manual_override: boolean;
  generation_constraints: string;
  final_prompt: string;
  confirmed: boolean;
};

export type ImagePromptGroup = {
  schema_version: 1;
  small_project_id: string;
  style: ImagePromptStyle;
  status: ImagePromptGroupStatus;
  items: ImagePromptGroupItem[];
  provenance: {
    created_by: string;
    llm_assisted: false;
  };
};

export type ImagePromptGroupValidationResult = {
  ok: boolean;
  issues: string[];
};

export const IMAGE_PROMPT_STYLE_PRESETS: readonly ImagePromptStyle[] = [
  {
    style_id: "high_contrast_cyber_classroom",
    label: "High contrast cyber classroom",
    style_prompt: "high contrast cyber classroom, crisp rap education visual language",
    source: "preset",
  },
  {
    style_id: "kinetic_stage_lights",
    label: "Kinetic stage lights",
    style_prompt: "kinetic concert stage lighting, sharp music video energy, cinematic contrast",
    source: "preset",
  },
  {
    style_id: "editorial_music_documentary",
    label: "Editorial music documentary",
    style_prompt: "editorial music documentary still, realistic texture, disciplined composition",
    source: "preset",
  },
];

const DEFAULT_GENERATION_CONSTRAINTS = "no readable text, no logos, no watermark";
const ALLOWED_PROMPT_GROUP_STATUSES: readonly ImagePromptGroupStatus[] = ["draft", "confirmation_required", "confirmed"];

export function createImagePromptGroup(input: {
  smallProjectId: string;
  schedule: ImageGenerationSchedule;
  styleId: string;
  scenePrompts?: Record<string, string>;
  createdBy?: string;
}): ImagePromptGroup {
  if (input.schedule.small_project_id !== input.smallProjectId) {
    throw new Error(`schedule small_project_id must be ${input.smallProjectId}`);
  }
  const style = promptStyle(input.styleId);
  const items = input.schedule.items
    .filter((item) => !item.skip)
    .map((item) => {
      const scenePrompt = input.scenePrompts?.[item.image_id] ?? input.scenePrompts?.[item.scene_id] ?? defaultScenePrompt(item.scene_id);
      return buildPromptGroupItem({
        imageId: item.image_id,
        sceneId: item.scene_id,
        stylePrompt: style.style_prompt,
        scenePrompt,
        manualOverride: Boolean(input.scenePrompts?.[item.image_id] ?? input.scenePrompts?.[item.scene_id]),
        confirmed: false,
      });
    });
  return {
    schema_version: 1,
    small_project_id: input.smallProjectId,
    style,
    status: "draft",
    items,
    provenance: {
      created_by: input.createdBy ?? "workbench",
      llm_assisted: false,
    },
  };
}

export async function writeImagePromptGroup(input: {
  projectRoot: string;
  promptGroup: ImagePromptGroup;
}): Promise<{ promptGroup: ImagePromptGroup; path: string }> {
  const relativePath = "data/storyboard/image_prompt_group.json";
  await writeJson(path.join(input.projectRoot, relativePath), input.promptGroup);
  return { promptGroup: input.promptGroup, path: relativePath };
}

export function confirmImagePromptGroup(promptGroup: ImagePromptGroup): ImagePromptGroup {
  const items = promptGroup.items.map((item) => ({
    ...item,
    final_prompt: buildFinalPrompt(promptGroup.style.style_prompt, item.scene_prompt, item.generation_constraints),
    confirmed: true,
  }));
  return {
    ...promptGroup,
    status: "confirmed",
    items,
    provenance: {
      ...promptGroup.provenance,
      llm_assisted: false,
    },
  };
}

export function changeImagePromptGroupStyle(input: {
  promptGroup: ImagePromptGroup;
  styleId: string;
}): ImagePromptGroup {
  const style = promptStyle(input.styleId);
  return {
    ...input.promptGroup,
    style,
    status: "confirmation_required",
    items: input.promptGroup.items.map((item) => ({
      ...item,
      final_prompt: buildFinalPrompt(style.style_prompt, item.scene_prompt, item.generation_constraints),
      confirmed: false,
    })),
    provenance: {
      ...input.promptGroup.provenance,
      llm_assisted: false,
    },
  };
}

export function buildConfirmedAdapterPrompts(input: {
  promptGroup: ImagePromptGroup;
}): Array<{ image_id: string; scene_id: string; prompt: string }> {
  const validation = validateImagePromptGroup({
    promptGroup: input.promptGroup,
    schedule: {
      schema_version: 1,
      small_project_id: input.promptGroup.small_project_id,
      source_section_map_sha256: "confirmed-adapter-prompts",
      status: "confirmed",
      generated_at: "",
      items: input.promptGroup.items.map((item) => ({
        image_id: item.image_id,
        scene_id: item.scene_id,
        section_ids: [],
        start_sec: 0,
        end_sec: 1,
        asset_role: "background",
        aspect_ratio: "9:16",
        target_size: { width: 1080, height: 1920 },
        recommendation_reason: "",
        status: "prompt_confirmed",
        skip: false,
      })),
      manual_overrides: [],
    },
  });
  if (!validation.ok) throw new Error(validation.issues.join("; "));
  if (input.promptGroup.status !== "confirmed") throw new Error("image prompt group must be confirmed before adapter prompts can be built");
  return input.promptGroup.items.map((item) => ({
    image_id: item.image_id,
    scene_id: item.scene_id,
    prompt: item.final_prompt,
  }));
}

export function validateImagePromptGroup(input: {
  promptGroup: unknown;
  schedule: ImageGenerationSchedule;
}): ImagePromptGroupValidationResult {
  const issues: string[] = [];
  const promptGroup = isRecord(input.promptGroup) ? input.promptGroup : null;
  if (!promptGroup) return { ok: false, issues: ["image prompt group must be a JSON object"] };

  if (promptGroup.schema_version !== 1) issues.push("image prompt group schema_version must be 1");
  if (promptGroup.small_project_id !== input.schedule.small_project_id) {
    issues.push(`image prompt group small_project_id must be ${input.schedule.small_project_id}`);
  }
  if (!ALLOWED_PROMPT_GROUP_STATUSES.includes(promptGroup.status as ImagePromptGroupStatus)) {
    issues.push("image prompt group status must be draft, confirmation_required, or confirmed");
  }

  const style = isRecord(promptGroup.style) ? promptGroup.style : null;
  const styleId = typeof style?.style_id === "string" ? style.style_id : null;
  const preset = styleId ? IMAGE_PROMPT_STYLE_PRESETS.find((candidate) => candidate.style_id === styleId) : null;
  if (!style) {
    issues.push("image prompt group style is required");
  } else {
    if (!preset) issues.push("image prompt group style_id must reference a built-in preset");
    if (style.source !== "preset") issues.push("image prompt group style.source must be preset");
    if (styleId && preset && style.style_prompt !== preset.style_prompt) {
      issues.push("image prompt group style_prompt must match the selected preset");
    }
  }

  const provenance = isRecord(promptGroup.provenance) ? promptGroup.provenance : null;
  if (!provenance) {
    issues.push("image prompt group provenance is required");
  } else if (provenance.llm_assisted !== false) {
    issues.push("image prompt group provenance.llm_assisted must be false in V3 P0");
  }

  if (!Array.isArray(promptGroup.items)) {
    issues.push("image prompt group items must be an array");
    return { ok: false, issues };
  }

  const requiredItems = input.schedule.items.filter((item) => !item.skip);
  const skippedImageIds = new Set(input.schedule.items.filter((item) => item.skip).map((item) => item.image_id));
  const requiredImageIds = new Set(requiredItems.map((item) => item.image_id));
  const scheduleSceneByImageId = new Map(requiredItems.map((item) => [item.image_id, item.scene_id]));
  const seen = new Set<string>();

  for (const [index, rawItem] of promptGroup.items.entries()) {
    const label = `items[${index}]`;
    if (!isRecord(rawItem)) {
      issues.push(`${label} must be an object`);
      continue;
    }
    const imageId = stringValue(rawItem.image_id);
    const sceneId = stringValue(rawItem.scene_id);
    if (!imageId) {
      issues.push(`${label}.image_id is required`);
      continue;
    }
    if (seen.has(imageId)) issues.push(`${label}.image_id duplicates ${imageId}`);
    seen.add(imageId);
    if (skippedImageIds.has(imageId)) issues.push(`${label}.image_id references a skipped schedule item`);
    if (!requiredImageIds.has(imageId)) issues.push(`${label}.image_id references an unknown schedule item ${imageId}`);
    if (!sceneId) issues.push(`${label}.scene_id is required`);
    if (sceneId && scheduleSceneByImageId.get(imageId) && sceneId !== scheduleSceneByImageId.get(imageId)) {
      issues.push(`${label}.scene_id must match schedule scene ${scheduleSceneByImageId.get(imageId)}`);
    }
    const scenePrompt = stringValue(rawItem.scene_prompt);
    if (!scenePrompt) issues.push(`${label}.scene_prompt is required`);
    if (typeof rawItem.manual_override !== "boolean") issues.push(`${label}.manual_override must be boolean`);
    const constraints = stringValue(rawItem.generation_constraints);
    if (!constraints) issues.push(`${label}.generation_constraints is required`);
    const finalPrompt = stringValue(rawItem.final_prompt);
    if (!finalPrompt) {
      issues.push(`${label}.final_prompt is required`);
    } else if (style && typeof style.style_prompt === "string" && scenePrompt && constraints) {
      const expected = buildFinalPrompt(style.style_prompt, scenePrompt, constraints);
      if (finalPrompt !== expected) issues.push(`${label}.final_prompt must derive from style, scene prompt, and constraints`);
    }
    if (typeof rawItem.confirmed !== "boolean") issues.push(`${label}.confirmed must be boolean`);
    if (promptGroup.status === "confirmed" && rawItem.confirmed !== true) {
      issues.push(`${label}.confirmed must be true when prompt group is confirmed`);
    }
  }

  for (const requiredImageId of requiredImageIds) {
    if (!seen.has(requiredImageId)) issues.push(`image prompt group is missing prompt for ${requiredImageId}`);
  }

  return { ok: issues.length === 0, issues };
}

function buildPromptGroupItem(input: {
  imageId: string;
  sceneId: string;
  stylePrompt: string;
  scenePrompt: string;
  manualOverride: boolean;
  confirmed: boolean;
}): ImagePromptGroupItem {
  return {
    image_id: input.imageId,
    scene_id: input.sceneId,
    scene_prompt: input.scenePrompt,
    manual_override: input.manualOverride,
    generation_constraints: DEFAULT_GENERATION_CONSTRAINTS,
    final_prompt: buildFinalPrompt(input.stylePrompt, input.scenePrompt, DEFAULT_GENERATION_CONSTRAINTS),
    confirmed: input.confirmed,
  };
}

function promptStyle(styleId: string): ImagePromptStyle {
  const style = IMAGE_PROMPT_STYLE_PRESETS.find((candidate) => candidate.style_id === styleId);
  if (!style) throw new Error(`Unknown image prompt style preset: ${styleId}`);
  return { ...style };
}

function buildFinalPrompt(stylePrompt: string, scenePrompt: string, generationConstraints: string): string {
  return [stylePrompt, scenePrompt, generationConstraints].map((part) => part.trim()).filter(Boolean).join("; ");
}

function defaultScenePrompt(sceneId: string): string {
  return `Production background image for ${sceneId}, cinematic composition, no text`;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
