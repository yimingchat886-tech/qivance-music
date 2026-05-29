import { readFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir, writeJson } from "./fs-utils.ts";

export type StoryboardScene = {
  scene_id: string;
  section_id: string;
  start_sec: number;
  end_sec: number;
  [key: string]: unknown;
};

export type StoryboardCaption = {
  start_sec: number;
  end_sec: number;
  text: string;
  [key: string]: unknown;
};

export type StoryboardVisual = {
  scene_id: string;
  [key: string]: unknown;
};

export type ValidStoryboardPayload = {
  scenes: StoryboardScene[];
  captions: StoryboardCaption[];
  visuals: StoryboardVisual[];
};

export type StoryboardImportResult = {
  sceneCount: number;
  captionCount: number;
  visualCount: number;
};

export async function importStoryboardFromJson(input: {
  projectPath: string;
  storyboardJson: string;
}): Promise<StoryboardImportResult> {
  const payload = validateStoryboardPayload(JSON.parse(input.storyboardJson));

  await ensureDir(path.join(input.projectPath, "data", "storyboard"));
  await ensureDir(path.join(input.projectPath, "qa", "storyboard"));
  await writeJson(path.join(input.projectPath, "data", "storyboard", "scene_plan.json"), { scenes: payload.scenes });
  await writeJson(path.join(input.projectPath, "data", "storyboard", "caption_plan.json"), { captions: payload.captions });
  await writeJson(path.join(input.projectPath, "data", "storyboard", "visual_plan.json"), { visuals: payload.visuals });
  await writeJson(path.join(input.projectPath, "qa", "storyboard", "scene_rule_check.json"), {
    gate_name: "Scene Rule Check",
    status: "human_pending",
    blocking_issues: [],
    warnings: [],
    auto_fixes_applied: [],
    input_artifacts: ["external_llm_storyboard_paste"],
    output_artifacts: [
      "data/storyboard/scene_plan.json",
      "data/storyboard/caption_plan.json",
      "data/storyboard/visual_plan.json",
    ],
    reviewer_type: "human",
    created_at: new Date().toISOString(),
  });
  await patchJson(path.join(input.projectPath, "project_manifest.json"), {
    current_workflow_state: "scene_waiting_human",
    updated_at: new Date().toISOString(),
  });
  await patchJson(path.join(input.projectPath, "workflow_snapshot.json"), {
    workflow_state: "scene_waiting_human",
    next_allowed_actions: ["approve_scene"],
    updated_at: new Date().toISOString(),
  });

  return {
    sceneCount: payload.scenes.length,
    captionCount: payload.captions.length,
    visualCount: payload.visuals.length,
  };
}

export function validateStoryboardPayload(value: unknown): ValidStoryboardPayload {
  if (!isRecord(value)) {
    throw new Error("Storyboard JSON must be an object.");
  }
  if (!Array.isArray(value.scenes)) {
    throw new Error("Storyboard JSON must include a scenes array.");
  }

  const scenes = value.scenes.map((scene, index) => validateScene(scene, index));
  validateNoSceneOverlap(scenes);

  return {
    scenes,
    captions: Array.isArray(value.captions) ? value.captions.map((caption, index) => validateCaption(caption, index)) : [],
    visuals: Array.isArray(value.visuals) ? value.visuals.map((visual, index) => validateVisual(visual, index)) : [],
  };
}

function validateScene(value: unknown, index: number): StoryboardScene {
  if (!isRecord(value)) {
    throw new Error(`Scene ${index + 1} must be an object.`);
  }
  const sceneId = stringField(value, "scene_id", `Scene ${index + 1}`);
  const sectionId = stringField(value, "section_id", `Scene ${index + 1}`);
  const startSec = finiteNumberField(value, "start_sec", `Scene ${index + 1}`);
  const endSec = finiteNumberField(value, "end_sec", `Scene ${index + 1}`);
  if (startSec < 0 || endSec <= startSec) {
    throw new Error(`Scene ${sceneId} must have non-negative timing with end_sec greater than start_sec.`);
  }
  return { ...value, scene_id: sceneId, section_id: sectionId, start_sec: startSec, end_sec: endSec };
}

function validateCaption(value: unknown, index: number): StoryboardCaption {
  if (!isRecord(value)) {
    throw new Error(`Caption ${index + 1} must be an object.`);
  }
  const startSec = finiteNumberField(value, "start_sec", `Caption ${index + 1}`);
  const endSec = finiteNumberField(value, "end_sec", `Caption ${index + 1}`);
  if (startSec < 0 || endSec <= startSec) {
    throw new Error(`Caption ${index + 1} must have non-negative timing with end_sec greater than start_sec.`);
  }
  return { ...value, start_sec: startSec, end_sec: endSec, text: stringField(value, "text", `Caption ${index + 1}`) };
}

function validateVisual(value: unknown, index: number): StoryboardVisual {
  if (!isRecord(value)) {
    throw new Error(`Visual ${index + 1} must be an object.`);
  }
  return { ...value, scene_id: stringField(value, "scene_id", `Visual ${index + 1}`) };
}

function validateNoSceneOverlap(scenes: StoryboardScene[]): void {
  const sorted = [...scenes].sort((a, b) => a.start_sec - b.start_sec);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].start_sec < sorted[index - 1].end_sec) {
      throw new Error(`Scene ${sorted[index].scene_id} overlaps scene ${sorted[index - 1].scene_id}.`);
    }
  }
}

function stringField(value: Record<string, unknown>, field: string, label: string): string {
  const result = value[field];
  if (typeof result !== "string" || result.trim().length === 0) {
    throw new Error(`${label} must include ${field}.`);
  }
  return result;
}

function finiteNumberField(value: Record<string, unknown>, field: string, label: string): number {
  const result = value[field];
  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new Error(`${label} ${field} must be a finite number.`);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function patchJson(filePath: string, patch: Record<string, unknown>): Promise<void> {
  const value = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
  await writeJson(filePath, { ...value, ...patch });
}
