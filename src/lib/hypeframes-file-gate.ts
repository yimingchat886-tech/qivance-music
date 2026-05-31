import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { writeQaReport } from "./gate-report.ts";

const requiredFiles = [
  "hypeframes/src/index.html",
  "hypeframes/src/styles.css",
  "hypeframes/src/main.js",
  "hypeframes/src/config.json",
  "hypeframes/generated/timeline.json",
  "hypeframes/generated/scene_plan.json",
  "hypeframes/generated/caption_plan.json",
  "hypeframes/generated/visual_plan.json",
  "hypeframes/render_targets/render_targets.json",
  "hypeframes/hypeframes_project_manifest.json",
  "audio/music_manifest.json",
  "data/timing/beats.locked.json",
  "data/timing/section_map.json",
  "data/storyboard/render_plan.json",
];

export async function runHypeframesFileGate(projectPath: string): Promise<void> {
  const blockingIssues: string[] = [];
  const warnings: string[] = [];
  for (const relativePath of requiredFiles) {
    const file = await fileInfo(path.join(projectPath, relativePath));
    if (!file.exists) blockingIssues.push(`Missing required HypeFrames file: ${relativePath}`);
    if (file.exists && file.sizeBytes === 0) blockingIssues.push(`Required HypeFrames file is empty: ${relativePath}`);
  }

  const config = await readOptionalJson<Record<string, unknown>>(path.join(projectPath, "hypeframes", "src", "config.json"));
  const sectionMap = await readOptionalJson<Record<string, unknown>>(path.join(projectPath, "data", "timing", "section_map.json"));
  const beats = await readOptionalJson<Record<string, unknown>>(path.join(projectPath, "data", "timing", "beats.locked.json"));
  const timeline = await readOptionalJson<Record<string, unknown>>(path.join(projectPath, "hypeframes", "generated", "timeline.json"));
  const renderTargets = await readOptionalJson<Record<string, unknown>>(
    path.join(projectPath, "hypeframes", "render_targets", "render_targets.json"),
  );
  const hypeframesManifest = await readOptionalJson<Record<string, unknown>>(
    path.join(projectPath, "hypeframes", "hypeframes_project_manifest.json"),
  );

  const configDuration = numberValue(config?.duration_sec);
  const sectionDuration = numberValue(sectionMap?.duration_sec);
  if (configDuration !== null && sectionDuration !== null && Math.abs(configDuration - sectionDuration) > 0.5) {
    blockingIssues.push("hypeframes/src/config.json duration_sec does not match section_map.duration_sec.");
  }

  const audioPath = stringValue(config?.audio_path);
  if (!audioPath) {
    blockingIssues.push("hypeframes/src/config.json audio_path is missing.");
  } else if (audioPath.includes("://") || audioPath.startsWith("/") || audioPath.includes("..")) {
    blockingIssues.push("hypeframes/src/config.json audio_path must be a project-local file.");
  } else if (!(await fileInfo(path.join(projectPath, "hypeframes", audioPath))).exists) {
    blockingIssues.push(`config audio_path does not exist: ${audioPath}`);
  }

  for (const relativePath of ["hypeframes/src/index.html", "hypeframes/src/styles.css", "hypeframes/src/main.js"]) {
    const text = await readOptionalText(path.join(projectPath, relativePath));
    if (/https?:\/\//i.test(text)) {
      blockingIssues.push(`HypeFrames file contains external URL: ${relativePath}`);
    }
  }

  if (!renderTargets || typeof renderTargets !== "object") {
    blockingIssues.push("render_targets.json must be an object.");
  } else {
    const preview = renderTargets.preview_composite as Record<string, unknown> | undefined;
    const review = renderTargets.preview_composite_review as Record<string, unknown> | undefined;
    if (!preview) blockingIssues.push("render_targets must include preview_composite.");
    if (!review) blockingIssues.push("render_targets must include preview_composite_review.");
    if (preview && preview.includes_review_markers === true) {
      blockingIssues.push("preview_composite must not include review markers.");
    }
    if (review && review.includes_review_markers !== true) {
      blockingIssues.push("preview_composite_review must include review markers.");
    }
    const manifestTargets = stringArray(hypeframesManifest?.render_targets);
    const targetKeys = Object.keys(renderTargets).sort();
    if (manifestTargets.length > 0 && manifestTargets.sort().join("|") !== targetKeys.join("|")) {
      blockingIssues.push("hypeframes_project_manifest render_targets do not match render_targets.json keys.");
    }
  }

  const beatHash = stringValue(beats?.audio_hash);
  const timelineHash = stringValue(timeline?.audio_hash);
  if (beatHash && timelineHash && beatHash !== timelineHash) {
    blockingIssues.push("generated timeline audio_hash does not match beats.locked audio_hash.");
  }

  const timelineDuration = numberValue(timeline?.duration_sec) ?? sectionDuration;
  if (timelineDuration !== null) {
    await checkPlanTiming("hypeframes/generated/scene_plan.json", "scenes", timelineDuration, projectPath, blockingIssues);
    await checkPlanTiming("hypeframes/generated/caption_plan.json", "captions", timelineDuration, projectPath, blockingIssues);
  }

  const skillsQa = await readOptionalJson<Record<string, unknown>>(
    path.join(projectPath, "qa", "hypeframes", "hyperframes_skills_qa_report.json"),
  );
  if (skillsQa?.status === "rule_fail_blocked") {
    blockingIssues.push("HyperFrames skills QA is blocking.");
  }

  const changedFiles = await readOptionalJson(path.join(projectPath, "logs", "codex", "latest.changed_files.json"));
  if (changedFiles) {
    const forbiddenQa = await readOptionalJson<Record<string, unknown>>(
      path.join(projectPath, "qa", "hypeframes", "codex_forbidden_path_qa_report.json"),
    );
    if (!forbiddenQa) {
      blockingIssues.push("Codex changed files exist but Codex forbidden path gate has not run.");
    } else if (forbiddenQa.status === "rule_fail_blocked") {
      blockingIssues.push("Codex forbidden path gate is blocking.");
    }
  }

  await writeQaReport(projectPath, "qa/hypeframes/hypeframes_file_qa_report.json", {
    gate_name: "HypeFrames File QA",
    status: blockingIssues.length > 0 ? "rule_fail_blocked" : warnings.length > 0 ? "rule_pass_with_warnings" : "rule_pass",
    blocking_issues: dedupe(blockingIssues),
    warnings: dedupe(warnings),
    input_artifacts: requiredFiles,
    output_artifacts: ["qa/hypeframes/hypeframes_file_qa_report.json"],
  });
}

async function checkPlanTiming(
  relativePath: string,
  arrayKey: string,
  duration: number,
  projectPath: string,
  blockingIssues: string[],
): Promise<void> {
  const value = await readOptionalJson<Record<string, unknown>>(path.join(projectPath, relativePath));
  const rows = Array.isArray(value?.[arrayKey]) ? value[arrayKey] as Record<string, unknown>[] : [];
  for (const [index, row] of rows.entries()) {
    const start = numberValue(row.start_sec);
    const end = numberValue(row.end_sec);
    if ((start !== null && start < 0) || (end !== null && end > duration + 0.25)) {
      blockingIssues.push(`${relativePath} ${arrayKey}[${index}] timing exceeds timeline duration.`);
    }
  }
}

async function fileInfo(filePath: string): Promise<{ exists: boolean; sizeBytes: number }> {
  try {
    const fileStat = await stat(filePath);
    return { exists: fileStat.isFile(), sizeBytes: fileStat.size };
  } catch {
    return { exists: false, sizeBytes: 0 };
  }
}

async function readOptionalJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function readOptionalText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
