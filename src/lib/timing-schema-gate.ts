import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeQaReport } from "./gate-report.ts";

type MusicManifest = {
  sha256?: unknown;
  duration_sec?: unknown;
};

type BeatLock = {
  audio_hash?: unknown;
  beats?: unknown;
  bars?: unknown;
};

type SectionMap = {
  audio_hash?: unknown;
  duration_sec?: unknown;
  sections?: unknown;
};

export async function runTimingSchemaGate(projectPath: string): Promise<void> {
  const manifest = await readJson<MusicManifest>(path.join(projectPath, "audio", "music_manifest.json"));
  const beats = await readJson<BeatLock>(path.join(projectPath, "data", "timing", "beats.locked.json"));
  const sectionMap = await readJson<SectionMap>(path.join(projectPath, "data", "timing", "section_map.json"));
  const density = await readOptionalJson<Record<string, unknown>>(
    path.join(projectPath, "data", "timing", "section_density_report.json"),
  );
  await readOptionalJson(path.join(projectPath, "data", "lyrics", "lyrics_structured.json"));

  const blockingIssues: string[] = [];
  const warnings: string[] = [];
  const audioHash = stringValue(manifest.sha256);
  const duration = numberValue(manifest.duration_sec);
  const beatAudioHash = stringValue(beats.audio_hash);
  const mapAudioHash = stringValue(sectionMap.audio_hash);
  const beatTimes = numberArray(beats.beats);
  const barTimes = numberArray(beats.bars);
  const mapDuration = numberValue(sectionMap.duration_sec);
  const sections = sectionArray(sectionMap.sections);

  if (!audioHash || beatAudioHash !== audioHash) {
    blockingIssues.push("beats.locked.audio_hash does not match music_manifest.sha256.");
  }
  if (!audioHash || mapAudioHash !== audioHash) {
    blockingIssues.push("section_map.audio_hash does not match music_manifest.sha256.");
  }
  if (!isMonotonic(beatTimes)) {
    blockingIssues.push("beats must be monotonic increasing.");
  }
  if (!isMonotonic(barTimes)) {
    blockingIssues.push("bars must be monotonic increasing.");
  }
  if (duration === null || duration <= 0) {
    blockingIssues.push("music_manifest.duration_sec must be positive.");
  } else {
    for (const beat of beatTimes) {
      if (beat > duration + 0.25) blockingIssues.push("beats contain out-of-range timing.");
    }
    for (const bar of barTimes) {
      if (bar > duration + 0.25) blockingIssues.push("bars contain out-of-range timing.");
    }
    if (mapDuration === null || Math.abs(mapDuration - duration) > 0.5) {
      blockingIssues.push("section_map.duration_sec differs from music_manifest.duration_sec by more than 0.5s.");
    }
  }
  if (sections.length === 0) {
    blockingIssues.push("section_map.sections must contain at least one section.");
  }

  for (const [index, section] of sections.entries()) {
    if (section.start_sec < 0 || section.start_sec >= section.end_sec) {
      blockingIssues.push(`section ${section.section_id} has invalid start/end timing.`);
    }
    if (mapDuration !== null && section.end_sec > mapDuration + 0.25) {
      blockingIssues.push(`section ${section.section_id} is out of range.`);
    }
    const previous = sections[index - 1];
    if (previous && section.start_sec < previous.end_sec) {
      blockingIssues.push(`section ${section.section_id} overlaps previous section.`);
    }
    if (/hook|chorus/i.test(section.label) && nearestDelta(section.start_sec, barTimes) > 0.25) {
      warnings.push(`section ${section.section_id} ${section.label} starts more than 0.25s from nearest bar.`);
    }
  }

  for (const densityWarning of densityWarnings(density)) {
    warnings.push(densityWarning);
  }

  const status = blockingIssues.length > 0
    ? "rule_fail_blocked"
    : warnings.length > 0
      ? "rule_pass_with_warnings"
      : "rule_pass";

  await writeQaReport(projectPath, "qa/timing/timing_qa_report.json", {
    gate_name: "Timing Schema Gate",
    status,
    blocking_issues: dedupe(blockingIssues),
    warnings: dedupe(warnings),
    input_artifacts: [
      "audio/music_manifest.json",
      "data/timing/beats.locked.json",
      "data/timing/section_map.json",
      "data/timing/section_density_report.json",
      "data/lyrics/lyrics_structured.json",
    ],
    output_artifacts: ["qa/timing/timing_qa_report.json"],
  });
}

function sectionArray(value: unknown): Array<{
  section_id: string;
  label: string;
  start_sec: number;
  end_sec: number;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const start = numberValue(record.start_sec);
    const end = numberValue(record.end_sec);
    if (start === null || end === null) return [];
    return [{
      section_id: stringValue(record.section_id) || `section_${index + 1}`,
      label: stringValue(record.label) || "",
      start_sec: start,
      end_sec: end,
    }];
  });
}

function densityWarnings(value: Record<string, unknown> | null): string[] {
  const sections = value?.sections;
  if (!Array.isArray(sections)) return [];
  return sections.flatMap((section, index) => {
    if (!section || typeof section !== "object") return [];
    const density = numberValue((section as Record<string, unknown>).density);
    return density !== null && density > 1.5 ? [`section density is high at index ${index}.`] : [];
  });
}

function isMonotonic(values: number[]): boolean {
  return values.every((value, index) => index === 0 || value > values[index - 1]);
}

function nearestDelta(value: number, times: number[]): number {
  if (times.length === 0) return 0;
  return Math.min(...times.map((time) => Math.abs(time - value)));
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
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
