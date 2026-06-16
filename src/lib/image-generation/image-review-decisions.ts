import { statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildLockedImageAssets, type ImageDecision } from "./image-assets.ts";
import type { ImageGenerationRequest, ImageGenerationResult } from "./types.ts";
import type { ImageGenerationSchedule, ImageGenerationScheduleItem } from "./image-schedule.ts";
import type { ImagePromptGroup, ImagePromptGroupItem } from "./image-prompt-group.ts";

export type ImageReviewAction = "lock" | "reject" | "skip" | "regenerate";

export type ImageReviewDecision = {
  decision_id: string;
  image_id: string;
  candidate_id?: string;
  candidate_path?: string;
  action: ImageReviewAction;
  reason?: string;
  decided_at: string;
  decided_by: string;
  prompt?: string;
  sha256?: string;
  width?: number;
  height?: number;
  provenance?: Record<string, unknown>;
  regenerate_prompt_override?: string;
};

export type ImageReviewDecisionFile = {
  schema_version: 1;
  small_project_id: string;
  decisions: ImageReviewDecision[];
};

export type ImageReviewDecisionValidationResult = {
  ok: boolean;
  issues: string[];
  lockedImageDecisions: ImageDecision[];
};

type CandidateRecord = ImageGenerationResult["candidates"][number] & {
  requestId: string;
  imageId: string;
  sceneId: string;
};

export function createImageReviewDecisionFile(input: {
  smallProjectId: string;
  decisions?: ImageReviewDecision[];
}): ImageReviewDecisionFile {
  return {
    schema_version: 1,
    small_project_id: input.smallProjectId,
    decisions: input.decisions ?? [],
  };
}

export async function readImageReviewDecisionFile(projectRoot: string, smallProjectId: string): Promise<ImageReviewDecisionFile> {
  const relativePath = "data/storyboard/image_review_decisions.json";
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(projectRoot, relativePath), "utf8"));
    const validation = validateImageReviewDecisionFile({
      review: parsed,
      smallProjectId,
      schedule: emptySchedule(smallProjectId),
      promptGroup: emptyPromptGroup(smallProjectId),
      imageResults: [],
      projectRoot,
      requireKnownImages: false,
    });
    if (!validation.ok) throw new Error(validation.issues.join("; "));
    return parsed as ImageReviewDecisionFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return createImageReviewDecisionFile({ smallProjectId });
    throw error;
  }
}

export async function writeImageReviewDecisionFile(input: {
  projectRoot: string;
  review: ImageReviewDecisionFile;
}): Promise<{ review: ImageReviewDecisionFile; path: string }> {
  const relativePath = "data/storyboard/image_review_decisions.json";
  await writeJson(path.join(input.projectRoot, relativePath), input.review);
  return { review: input.review, path: relativePath };
}

export function applyImageReviewAction(input: {
  review: ImageReviewDecisionFile;
  action: ImageReviewAction;
  imageId: string;
  candidateId?: string;
  candidatePath?: string;
  reason?: string;
  decidedAt?: string;
  decidedBy?: string;
  prompt?: string;
  sha256?: string;
  width?: number;
  height?: number;
  provenance?: Record<string, unknown>;
  regeneratePromptOverride?: string;
}): ImageReviewDecisionFile {
  const decidedAt = input.decidedAt ?? new Date().toISOString();
  const decision: ImageReviewDecision = {
    decision_id: `decision_${safeId(input.imageId)}_${input.action}_${decisionSuffix(decidedAt)}`,
    image_id: input.imageId,
    action: input.action,
    decided_at: decidedAt,
    decided_by: input.decidedBy ?? "local-user",
    ...(input.candidateId ? { candidate_id: input.candidateId } : {}),
    ...(input.candidatePath ? { candidate_path: input.candidatePath } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.prompt ? { prompt: input.prompt } : {}),
    ...(input.sha256 ? { sha256: input.sha256 } : {}),
    ...(input.width ? { width: input.width } : {}),
    ...(input.height ? { height: input.height } : {}),
    ...(input.provenance ? { provenance: input.provenance } : {}),
    ...(input.regeneratePromptOverride ? { regenerate_prompt_override: input.regeneratePromptOverride } : {}),
  };
  const withoutPreviousDecisionForImage = input.review.decisions.filter((existing) => existing.image_id !== input.imageId);
  return {
    ...input.review,
    decisions: [...withoutPreviousDecisionForImage, decision],
  };
}

export function validateImageReviewDecisionFile(input: {
  review: unknown;
  smallProjectId: string;
  schedule: ImageGenerationSchedule;
  promptGroup: ImagePromptGroup;
  imageResults: ImageGenerationResult[];
  projectRoot?: string;
  requireKnownImages?: boolean;
}): ImageReviewDecisionValidationResult {
  const issues: string[] = [];
  const review = isRecord(input.review) ? input.review : null;
  if (!review) return { ok: false, issues: ["image review decisions must be a JSON object"], lockedImageDecisions: [] };
  if (review.schema_version !== 1) issues.push("image review decisions schema_version must be 1");
  if (review.small_project_id !== input.smallProjectId) {
    issues.push(`image review decisions small_project_id must be ${input.smallProjectId}`);
  }
  if (!Array.isArray(review.decisions)) {
    issues.push("image review decisions must contain decisions[]");
    return { ok: false, issues, lockedImageDecisions: [] };
  }

  const scheduleByImageId = new Map(input.schedule.items.map((item) => [item.image_id, item]));
  const promptByImageId = new Map(input.promptGroup.items.map((item) => [item.image_id, item]));
  const candidateById = candidateMap(input.imageResults, input.schedule);
  const strictReferences = input.requireKnownImages !== false;
  const seenDecisionIds = new Set<string>();
  const seenImageIds = new Set<string>();
  const lockedImageDecisions: ImageDecision[] = [];

  for (const [index, rawDecision] of review.decisions.entries()) {
    const label = `decisions[${index}]`;
    if (!isRecord(rawDecision)) {
      issues.push(`${label} must be an object`);
      continue;
    }
    const decisionId = stringValue(rawDecision.decision_id);
    const imageId = stringValue(rawDecision.image_id);
    const action = reviewAction(rawDecision.action);
    if (!decisionId) {
      issues.push(`${label}.decision_id is required`);
    } else if (seenDecisionIds.has(decisionId)) {
      issues.push(`${label}.decision_id duplicates ${decisionId}`);
    } else {
      seenDecisionIds.add(decisionId);
    }
    if (!imageId) {
      issues.push(`${label}.image_id is required`);
      continue;
    }
    if (seenImageIds.has(imageId)) issues.push(`${label}.image_id has more than one active decision`);
    seenImageIds.add(imageId);
    const scheduleItem = scheduleByImageId.get(imageId);
    if (!scheduleItem && strictReferences) {
      issues.push(`${label}.image_id references unknown schedule image ${imageId}`);
    }
    if (!action) {
      issues.push(`${label}.action must be lock, reject, skip, or regenerate`);
      continue;
    }
    if (typeof rawDecision.decided_at !== "string" || rawDecision.decided_at.length === 0) {
      issues.push(`${label}.decided_at is required`);
    }
    if (typeof rawDecision.decided_by !== "string" || rawDecision.decided_by.length === 0) {
      issues.push(`${label}.decided_by is required`);
    }
    if (action === "lock") {
      const lockedDecision = validateLockDecision({
        label,
        rawDecision,
        imageId,
        scheduleItem,
        promptItem: promptByImageId.get(imageId),
        candidateById,
        projectRoot: input.projectRoot,
        strictReferences,
        issues,
      });
      if (lockedDecision) lockedImageDecisions.push(lockedDecision);
    }
    if (action === "reject" && strictReferences) validateCandidateDecision(label, rawDecision, candidateById, issues);
    if (action === "skip" && strictReferences && scheduleItem && !scheduleItem.skip && scheduleItem.status !== "skipped") {
      issues.push(`${label}.skip decision requires the linked schedule item to be skipped`);
    }
    if (action === "regenerate" && strictReferences) {
      const promptItem = promptByImageId.get(imageId);
      if (!promptItem) issues.push(`${label}.regenerate requires a prompt group item`);
      if (promptItem && !promptItem.confirmed) issues.push(`${label}.regenerate requires confirmed prompt text`);
      if (input.promptGroup.status !== "confirmed") issues.push(`${label}.regenerate requires a confirmed prompt group`);
    }
  }

  return { ok: issues.length === 0, issues, lockedImageDecisions };
}

export async function writeLockedImageAssetsFromReview(input: {
  projectRoot: string;
  smallProjectId: string;
  review: ImageReviewDecisionFile;
  schedule: ImageGenerationSchedule;
  promptGroup: ImagePromptGroup;
  imageResults: ImageGenerationResult[];
}): Promise<{ imageAssets: ReturnType<typeof buildLockedImageAssets>; path: string }> {
  const validation = validateImageReviewDecisionFile({
    review: input.review,
    smallProjectId: input.smallProjectId,
    schedule: input.schedule,
    promptGroup: input.promptGroup,
    imageResults: input.imageResults,
    projectRoot: input.projectRoot,
  });
  if (!validation.ok) throw new Error(validation.issues.join("; "));
  const imageAssets = buildLockedImageAssets({
    smallProjectId: input.smallProjectId,
    decisions: validation.lockedImageDecisions,
  });
  const relativePath = "data/storyboard/image_assets.json";
  await writeJson(path.join(input.projectRoot, relativePath), imageAssets);
  return { imageAssets, path: relativePath };
}

export function buildRegenerationImageRequest(input: {
  imageId: string;
  schedule: ImageGenerationSchedule;
  promptGroup: ImagePromptGroup;
  outputDir: string;
  variants?: number;
  promptOverride?: string;
}): ImageGenerationRequest {
  const scheduleItem = input.schedule.items.find((item) => item.image_id === input.imageId);
  if (!scheduleItem) throw new Error(`Unknown schedule image: ${input.imageId}`);
  if (scheduleItem.skip) throw new Error(`Cannot regenerate skipped image: ${input.imageId}`);
  const promptItem = input.promptGroup.items.find((item) => item.image_id === input.imageId);
  if (!promptItem || !promptItem.confirmed || input.promptGroup.status !== "confirmed") {
    throw new Error("Regenerate requires confirmed prompt group text");
  }
  const prompt = input.promptOverride
    ? buildFinalPrompt(input.promptGroup.style.style_prompt, input.promptOverride, promptItem.generation_constraints)
    : promptItem.final_prompt;
  return {
    requestId: `regen_${input.imageId}`,
    sceneId: scheduleItem.scene_id,
    assetRole: scheduleItem.asset_role,
    prompt,
    referenceAssetIds: [],
    aspectRatio: scheduleItem.aspect_ratio,
    targetSize: scheduleItem.target_size,
    variants: input.variants ?? 1,
    outputDir: input.outputDir,
  };
}

function validateLockDecision(input: {
  label: string;
  rawDecision: Record<string, unknown>;
  imageId: string;
  scheduleItem: ImageGenerationScheduleItem | undefined;
  promptItem: ImagePromptGroupItem | undefined;
  candidateById: Map<string, CandidateRecord>;
  projectRoot: string | undefined;
  strictReferences: boolean;
  issues: string[];
}): ImageDecision | null {
  const candidateId = stringValue(input.rawDecision.candidate_id);
  const candidatePath = stringValue(input.rawDecision.candidate_path);
  const sha256 = stringValue(input.rawDecision.sha256);
  const prompt = stringValue(input.rawDecision.prompt);
  const width = numberValue(input.rawDecision.width);
  const height = numberValue(input.rawDecision.height);
  if (!candidatePath) input.issues.push(`${input.label}.candidate_path is required for lock`);
  const candidate = candidateId ? input.candidateById.get(candidateId) : null;
  if (candidatePath && input.projectRoot) {
    const resolved = resolveProjectRelativePath(input.projectRoot, candidatePath);
    if (!resolved) {
      input.issues.push(`${input.label}.candidate_path must be project-relative`);
    } else if (input.strictReferences && !isFile(resolved.absolutePath)) {
      input.issues.push(`${input.label}.candidate_path file must exist under the project root`);
    }
  }
  if (input.strictReferences) {
    if (!input.scheduleItem) input.issues.push(`${input.label}.lock requires a linked schedule item`);
    if (input.scheduleItem && input.scheduleItem.skip) input.issues.push(`${input.label}.lock cannot target a skipped schedule item`);
    if (!input.promptItem) {
      input.issues.push(`${input.label}.lock requires a prompt group item`);
    } else if (!input.promptItem.confirmed) {
      input.issues.push(`${input.label}.lock requires confirmed prompt text`);
    }
    if (!candidateId) input.issues.push(`${input.label}.candidate_id is required for lock`);
    if (candidateId && !candidate) input.issues.push(`${input.label}.candidate_id references unknown generated candidate ${candidateId}`);
    if (candidate && candidate.imageId !== input.imageId) input.issues.push(`${input.label}.candidate_id belongs to ${candidate.imageId}, not ${input.imageId}`);
    if (candidate && candidatePath && !candidatePathMatches(candidate.path, candidatePath, input.projectRoot)) {
      input.issues.push(`${input.label}.candidate_path does not match generated candidate ${candidateId}`);
    }
    if (!sha256) input.issues.push(`${input.label}.sha256 is required for lock`);
    if (candidate && sha256 && sha256 !== candidate.sha256) input.issues.push(`${input.label}.sha256 does not match generated candidate ${candidateId}`);
    if (!width || !height) input.issues.push(`${input.label}.width and height are required for lock`);
    if (candidate && width && width !== candidate.width) input.issues.push(`${input.label}.width does not match generated candidate ${candidateId}`);
    if (candidate && height && height !== candidate.height) input.issues.push(`${input.label}.height does not match generated candidate ${candidateId}`);
    if (!prompt) input.issues.push(`${input.label}.prompt is required for lock`);
    if (input.promptItem && prompt && prompt !== input.promptItem.final_prompt) input.issues.push(`${input.label}.prompt must match confirmed final prompt`);
    if (!isRecord(input.rawDecision.provenance)) input.issues.push(`${input.label}.provenance is required for lock`);
  }

  if (!input.strictReferences || !candidateId || !candidatePath || !sha256 || !prompt || !input.scheduleItem || !input.promptItem) return null;
  return {
    candidateId,
    sceneId: input.scheduleItem.scene_id,
    role: "background",
    path: candidatePath,
    sha256,
    prompt,
    status: "locked",
    decisionSource: "workbench",
    reason: stringValue(input.rawDecision.reason) ?? undefined,
    decidedBy: stringValue(input.rawDecision.decided_by) ?? undefined,
    decidedAt: stringValue(input.rawDecision.decided_at) ?? undefined,
  };
}

function validateCandidateDecision(
  label: string,
  rawDecision: Record<string, unknown>,
  candidateById: Map<string, CandidateRecord>,
  issues: string[],
): void {
  const candidateId = stringValue(rawDecision.candidate_id);
  if (!candidateId) {
    issues.push(`${label}.candidate_id is required`);
    return;
  }
  if (!candidateById.has(candidateId)) issues.push(`${label}.candidate_id references unknown generated candidate ${candidateId}`);
}

function candidateMap(results: ImageGenerationResult[], schedule: ImageGenerationSchedule): Map<string, CandidateRecord> {
  const scheduleByRequestId = new Map(schedule.items.map((item) => [item.image_id, item]));
  const map = new Map<string, CandidateRecord>();
  for (const result of results) {
    const imageId = result.requestId.replace(/^regen_/, "");
    const scheduleItem = scheduleByRequestId.get(imageId);
    for (const candidate of result.candidates) {
      map.set(candidate.candidateId, {
        ...candidate,
        requestId: result.requestId,
        imageId,
        sceneId: scheduleItem?.scene_id ?? imageId,
      });
    }
  }
  return map;
}

function emptySchedule(smallProjectId: string): ImageGenerationSchedule {
  return {
    schema_version: 1,
    small_project_id: smallProjectId,
    source_section_map_sha256: "empty",
    status: "draft",
    generated_at: "",
    items: [],
    manual_overrides: [],
  };
}

function emptyPromptGroup(smallProjectId: string): ImagePromptGroup {
  return {
    schema_version: 1,
    small_project_id: smallProjectId,
    style: { style_id: "empty", label: "empty", style_prompt: "empty", source: "preset" },
    status: "draft",
    items: [],
    provenance: { created_by: "workbench", llm_assisted: false },
  };
}

function reviewAction(value: unknown): ImageReviewAction | null {
  return value === "lock" || value === "reject" || value === "skip" || value === "regenerate" ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProjectRelativePath(value: string): boolean {
  return !path.isAbsolute(value) && !value.split(/[\\/]+/).includes("..");
}

function normalizePath(value: string): string {
  return value.replaceAll(path.sep, "/");
}

function resolveProjectRelativePath(projectRoot: string, value: string): { relativePath: string; absolutePath: string } | null {
  if (!isProjectRelativePath(value)) return null;
  const root = path.resolve(projectRoot);
  const absolutePath = path.resolve(root, value);
  if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) return null;
  return {
    relativePath: normalizePath(path.relative(root, absolutePath)),
    absolutePath,
  };
}

function candidatePathMatches(candidatePath: string, decisionPath: string, projectRoot: string | undefined): boolean {
  const normalizedDecision = normalizePath(decisionPath);
  if (projectRoot && path.isAbsolute(candidatePath)) {
    const resolvedDecision = resolveProjectRelativePath(projectRoot, decisionPath);
    if (!resolvedDecision) return false;
    return normalizePath(path.relative(path.resolve(projectRoot), candidatePath)) === resolvedDecision.relativePath;
  }
  return normalizePath(candidatePath) === normalizedDecision;
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function buildFinalPrompt(stylePrompt: string, scenePrompt: string, generationConstraints: string): string {
  return [stylePrompt, scenePrompt, generationConstraints].map((part) => part.trim()).filter(Boolean).join("; ");
}

function safeId(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_]+/g, "_").replaceAll(/^_+|_+$/g, "");
}

function decisionSuffix(value: string | undefined): string {
  return (value ?? new Date().toISOString()).replaceAll(/[^0-9A-Za-z]+/g, "_").replaceAll(/^_+|_+$/g, "");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
