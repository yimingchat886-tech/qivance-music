import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeQaReport } from "./gate-report.ts";

const allowedTemplates = new Set([
  "concept_card",
  "cause_effect",
  "compare_grid",
  "myth_fact",
  "timeline",
  "process_diagram",
]);

const forbiddenVisualKeywords = [
  "particle",
  "particles",
  "waveform",
  "abstract",
  "cyber background",
  "random glow",
  "visualizer only",
];

export async function runSceneRuleGate(projectPath: string): Promise<void> {
  const beats = await readJson<Record<string, unknown>>(path.join(projectPath, "data", "timing", "beats.locked.json"));
  const sectionMap = await readJson<Record<string, unknown>>(path.join(projectPath, "data", "timing", "section_map.json"));
  const scenePlan = await readJson<Record<string, unknown>>(path.join(projectPath, "data", "storyboard", "scene_plan.json"));
  const captionPlan = await readJson<Record<string, unknown>>(path.join(projectPath, "data", "storyboard", "caption_plan.json"));
  const visualPlan = await readJson<Record<string, unknown>>(path.join(projectPath, "data", "storyboard", "visual_plan.json"));
  const facts = await readOptionalJson<Record<string, unknown>>(path.join(projectPath, "data", "facts", "facts.json"));
  const bars = numberArray(beats.bars);
  const sections = sectionArray(sectionMap.sections);
  const scenes = recordArray(scenePlan.scenes);
  const captions = recordArray(captionPlan.captions);
  const visuals = recordArray(visualPlan.visuals);
  const blockingIssues: string[] = [];
  const warnings: string[] = [];

  for (const [index, scene] of scenes.entries()) {
    const sceneId = stringValue(scene.scene_id);
    const sectionId = stringValue(scene.section_id);
    const start = numberValue(scene.start_sec);
    const end = numberValue(scene.end_sec);
    const template = stringValue(scene.template);
    if (!sceneId || !sectionId || start === null || end === null || !template) {
      blockingIssues.push(`scene at index ${index} is missing scene_id, section_id, start_sec, end_sec, or template.`);
      continue;
    }
    if (!allowedTemplates.has(template)) {
      blockingIssues.push(`scene ${sceneId} uses invalid template: ${template}.`);
    }
    const section = sections.find((candidate) => candidate.section_id === sectionId);
    if (!section || start < section.start_sec || end > section.end_sec || start >= end) {
      blockingIssues.push(`scene ${sceneId} timing is outside its section.`);
    }
    if (nearestDelta(start, bars) > 0.25) {
      warnings.push(`scene ${sceneId} starts more than 0.25s from nearest bar.`);
    }
  }

  for (const [index, caption] of captions.entries()) {
    const sceneId = stringValue(caption.scene_id);
    const start = numberValue(caption.start_sec);
    const end = numberValue(caption.end_sec);
    const text = stringValue(caption.text) ?? "";
    const scene = scenes.find((candidate) => stringValue(candidate.scene_id) === sceneId);
    const sceneStart = scene ? numberValue(scene.start_sec) : null;
    const sceneEnd = scene ? numberValue(scene.end_sec) : null;
    if (!scene || start === null || end === null || sceneStart === null || sceneEnd === null) {
      blockingIssues.push(`caption at index ${index} does not reference a valid scene.`);
      continue;
    }
    if (start < sceneStart || end > sceneEnd || start >= end) {
      blockingIssues.push(`caption at index ${index} is outside scene ${sceneId}.`);
    }
    const duration = end - start;
    if (duration < 0.2) {
      blockingIssues.push(`caption at index ${index} duration is too short.`);
    } else if (duration < 0.45) {
      warnings.push(`caption at index ${index} duration is below 0.45s.`);
    }
    if (text.length / Math.max(0.1, duration) > 18) {
      warnings.push(`caption at index ${index} is dense for its duration.`);
    }
  }

  for (const visual of visuals) {
    const sceneId = stringValue(visual.scene_id) ?? "unknown";
    const text = JSON.stringify(visual).toLowerCase();
    const matched = forbiddenVisualKeywords.find((keyword) => text.includes(keyword));
    if (matched) {
      warnings.push(`visual for ${sceneId} contains pure atmosphere keyword: ${matched}.`);
    }
    const elements = Array.isArray(visual.elements) ? visual.elements : [];
    if (elements.length < 1 || elements.length > 3) {
      warnings.push(`visual for ${sceneId} should contain 1-3 visual nodes.`);
    }
  }

  if (facts) {
    warnings.push("facts coverage is present but only warning-enforced in MVP.");
  }

  const status = blockingIssues.length > 0
    ? "rule_fail_blocked"
    : warnings.length > 0
      ? "rule_pass_with_warnings"
      : "human_pending";

  await writeQaReport(projectPath, "qa/storyboard/scene_rule_check.json", {
    gate_name: "Scene Rule Check",
    status,
    blocking_issues: dedupe(blockingIssues),
    warnings: dedupe(warnings),
    input_artifacts: [
      "data/timing/beats.locked.json",
      "data/timing/section_map.json",
      "data/storyboard/scene_plan.json",
      "data/storyboard/caption_plan.json",
      "data/storyboard/visual_plan.json",
    ],
    output_artifacts: ["qa/storyboard/scene_rule_check.json"],
  });
}

function sectionArray(value: unknown): Array<{ section_id: string; start_sec: number; end_sec: number }> {
  return recordArray(value).flatMap((section) => {
    const section_id = stringValue(section.section_id);
    const start_sec = numberValue(section.start_sec);
    const end_sec = numberValue(section.end_sec);
    return section_id && start_sec !== null && end_sec !== null ? [{ section_id, start_sec, end_sec }] : [];
  });
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
}

function nearestDelta(value: number, times: number[]): number {
  if (times.length === 0) return 0;
  return Math.min(...times.map((time) => Math.abs(time - value)));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function readOptionalJson<T>(filePath: string): Promise<T | null> {
  try {
    return await readJson<T>(filePath);
  } catch {
    return null;
  }
}
