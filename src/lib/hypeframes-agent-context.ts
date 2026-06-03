import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { writeJson } from "./fs-utils.ts";
import { writeQaReport, type QaStatus } from "./gate-report.ts";

export type HypeframesAgentContext = {
  schema_version: "qivance.hypeframes.agent_context.v1";
  created_at: string;
  project: {
    project_id: string;
    title: string | null;
    topic: string | null;
    style_preset: string | null;
  };
  track: {
    duration_sec: number;
    bpm: number;
    bpm_confidence: number;
    downbeat_sec: number;
    audio_hash: string;
    master_audio_path: "audio/master/minimax_rap_master.wav";
    hypeframes_audio_path: "hypeframes/public_assets/audio/minimax_rap_master.wav";
  };
  render: {
    width: number;
    height: number;
    fps: number;
    video_size: string;
    main_composition: string;
    preview_output: "dist/preview/preview_composite.mp4";
    review_output: "dist/review/preview_composite_review.mp4";
  };
  timing: {
    source_files: {
      beats_locked: "data/timing/beats.locked.json";
      section_map: "data/timing/section_map.json";
    };
    beat_count: number;
    bar_count: number;
    sections: Array<{
      section_id: string;
      label: string;
      start_sec: number;
      end_sec: number;
      lyric_line_count: number;
    }>;
  };
  lyrics: {
    source_file: string;
    sections: Array<{
      section_id: string;
      label: string;
      lines: string[];
    }>;
  };
  storyboard: {
    source_files: {
      scene_plan: "data/storyboard/scene_plan.json";
      caption_plan: "data/storyboard/caption_plan.json";
      visual_plan: "data/storyboard/visual_plan.json";
    };
    scenes: Array<{
      scene_id: string;
      section_id: string;
      start_sec: number;
      end_sec: number;
      objective: string;
      visual_nodes: string[];
      safe_area: string;
    }>;
    caption_count: number;
    visual_style_tokens: string[];
  };
  constraints: {
    source_of_truth: string[];
    allowed_write_globs: string[];
    forbidden_write_globs: string[];
    no_external_urls: true;
    no_timing_truth_edits: true;
    no_audio_edits: true;
    deterministic_render: true;
  };
};

type MusicManifest = {
  duration_sec?: unknown;
  sha256?: unknown;
  master_path?: unknown;
};

type BeatLock = {
  audio_hash?: unknown;
  bpm?: unknown;
  bpm_confidence?: unknown;
  downbeat_sec?: unknown;
  beats?: unknown;
  bars?: unknown;
};

type SectionMap = {
  duration_sec?: unknown;
  sections?: unknown;
};

type HypeframesConfig = {
  width?: unknown;
  height?: unknown;
  fps?: unknown;
  video_size?: unknown;
  main_composition?: unknown;
};

export async function writeHypeframesAgentContext(projectPath: string): Promise<HypeframesAgentContext> {
  const manifest = await readJson<MusicManifest>(projectPath, "audio/music_manifest.json");
  const beats = await readJson<BeatLock>(projectPath, "data/timing/beats.locked.json");
  const sectionMap = await readJson<SectionMap>(projectPath, "data/timing/section_map.json");
  const lyrics = await readOptionalJson<Record<string, unknown>>(projectPath, "data/lyrics/lyrics_structured.json");
  const scenePlan = await readJson<Record<string, unknown>>(projectPath, "data/storyboard/scene_plan.json");
  const captionPlan = await readJson<Record<string, unknown>>(projectPath, "data/storyboard/caption_plan.json");
  const visualPlan = await readJson<Record<string, unknown>>(projectPath, "data/storyboard/visual_plan.json");
  const config = await readJson<HypeframesConfig>(projectPath, "hypeframes/src/config.json");
  const project = await readOptionalJson<Record<string, unknown>>(projectPath, "project_manifest.json");

  const context: HypeframesAgentContext = {
    schema_version: "qivance.hypeframes.agent_context.v1",
    created_at: new Date().toISOString(),
    project: {
      project_id: stringValue(project?.project_id) ?? path.basename(projectPath),
      title: stringValue(project?.title),
      topic: stringValue(project?.topic),
      style_preset: stringValue(project?.style_preset),
    },
    track: {
      duration_sec: numberValue(manifest.duration_sec) ?? 0,
      bpm: numberValue(beats.bpm) ?? 0,
      bpm_confidence: numberValue(beats.bpm_confidence) ?? 0,
      downbeat_sec: numberValue(beats.downbeat_sec) ?? 0,
      audio_hash: stringValue(manifest.sha256) ?? "",
      master_audio_path: "audio/master/minimax_rap_master.wav",
      hypeframes_audio_path: "hypeframes/public_assets/audio/minimax_rap_master.wav",
    },
    render: {
      width: numberValue(config.width) ?? numberValue(project?.video_width) ?? 1080,
      height: numberValue(config.height) ?? numberValue(project?.video_height) ?? 1920,
      fps: numberValue(config.fps) ?? 30,
      video_size: stringValue(config.video_size) ?? stringValue(project?.video_size) ?? "9:16",
      main_composition: stringValue(config.main_composition) ?? stringValue(project?.main_composition) ?? "main",
      preview_output: "dist/preview/preview_composite.mp4",
      review_output: "dist/review/preview_composite_review.mp4",
    },
    timing: {
      source_files: {
        beats_locked: "data/timing/beats.locked.json",
        section_map: "data/timing/section_map.json",
      },
      beat_count: Array.isArray(beats.beats) ? beats.beats.length : 0,
      bar_count: Array.isArray(beats.bars) ? beats.bars.length : 0,
      sections: sectionRows(sectionMap).map((section) => ({
        section_id: stringValue(section.section_id) ?? "",
        label: stringValue(section.label) ?? "",
        start_sec: numberValue(section.start_sec) ?? 0,
        end_sec: numberValue(section.end_sec) ?? 0,
        lyric_line_count: stringArray(section.lyric_lines).length,
      })),
    },
    lyrics: {
      source_file: "data/lyrics/lyrics_structured.json",
      sections: lyricRows(lyrics).map((section, index) => ({
        section_id: sectionRows(sectionMap)[index]?.section_id ? String(sectionRows(sectionMap)[index].section_id) : `sec_${String(index + 1).padStart(3, "0")}`,
        label: stringValue(section.label) ?? "",
        lines: stringArray(section.lines),
      })),
    },
    storyboard: {
      source_files: {
        scene_plan: "data/storyboard/scene_plan.json",
        caption_plan: "data/storyboard/caption_plan.json",
        visual_plan: "data/storyboard/visual_plan.json",
      },
      scenes: sceneRows(scenePlan).map((scene) => ({
        scene_id: stringValue(scene.scene_id) ?? "",
        section_id: stringValue(scene.section_id) ?? "",
        start_sec: numberValue(scene.start_sec) ?? 0,
        end_sec: numberValue(scene.end_sec) ?? 0,
        objective: stringValue(scene.objective) ?? "",
        visual_nodes: stringArray(scene.visual_nodes),
        safe_area: stringValue(scene.safe_area) ?? "",
      })),
      caption_count: captionRows(captionPlan).length,
      visual_style_tokens: collectStyleTokens(visualPlan),
    },
    constraints: {
      source_of_truth: [
        "audio/music_manifest.json",
        "data/timing/beats.locked.json",
        "data/timing/section_map.json",
        "data/lyrics/lyrics_structured.json",
        "data/storyboard/scene_plan.json",
        "data/storyboard/caption_plan.json",
        "data/storyboard/visual_plan.json",
      ],
      allowed_write_globs: ["hypeframes/**", "qa/hypeframes/**", "logs/codex/**"],
      forbidden_write_globs: [
        "audio/**",
        "data/timing/**",
        "data/lyrics/**",
        "project_manifest.json",
        "workflow_snapshot.json",
        "dist/**",
        "qa/music/**",
        "qa/timing/**",
      ],
      no_external_urls: true,
      no_timing_truth_edits: true,
      no_audio_edits: true,
      deterministic_render: true,
    },
  };

  await writeJson(path.join(projectPath, "hypeframes", "generated", "agent_context.json"), context);
  await writeAgentContextQa(projectPath, context, stringValue(beats.audio_hash));
  return context;
}

export async function readHypeframesAgentContext(projectPath: string): Promise<HypeframesAgentContext> {
  return await readJson<HypeframesAgentContext>(projectPath, "hypeframes/generated/agent_context.json");
}

async function writeAgentContextQa(
  projectPath: string,
  context: HypeframesAgentContext,
  beatAudioHash: string | null,
): Promise<void> {
  const blockingIssues: string[] = [];
  if (context.track.duration_sec <= 0) blockingIssues.push("agent_context track.duration_sec must be greater than 0.");
  if (context.track.bpm <= 0) blockingIssues.push("agent_context track.bpm must be greater than 0.");
  if (!context.track.audio_hash) blockingIssues.push("agent_context track.audio_hash is missing.");
  if (beatAudioHash && context.track.audio_hash && beatAudioHash !== context.track.audio_hash) {
    blockingIssues.push("agent_context track.audio_hash does not match beats.locked audio_hash.");
  }
  if (!(await fileExists(path.join(projectPath, context.track.master_audio_path)))) {
    blockingIssues.push("agent_context master audio path is missing.");
  }
  if (!(await fileExists(path.join(projectPath, context.track.hypeframes_audio_path)))) {
    blockingIssues.push("agent_context HypeFrames audio path is missing.");
  }
  if (context.render.width <= 0 || context.render.height <= 0 || context.render.fps <= 0) {
    blockingIssues.push("agent_context render width, height, and fps must be positive.");
  }

  const status: QaStatus = blockingIssues.length > 0 ? "rule_fail_blocked" : "rule_pass";
  await writeQaReport(projectPath, "qa/hypeframes/hypeframes_agent_context_qa_report.json", {
    gate_name: "HypeFrames Agent Context QA",
    status,
    blocking_issues: blockingIssues,
    input_artifacts: context.constraints.source_of_truth,
    output_artifacts: [
      "hypeframes/generated/agent_context.json",
      "qa/hypeframes/hypeframes_agent_context_qa_report.json",
    ],
  });
}

async function readJson<T>(projectPath: string, relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(projectPath, relativePath), "utf8")) as T;
}

async function readOptionalJson<T>(projectPath: string, relativePath: string): Promise<T | null> {
  try {
    return await readJson<T>(projectPath, relativePath);
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() && fileStat.size > 0;
  } catch {
    return false;
  }
}

function sectionRows(sectionMap: SectionMap): Record<string, unknown>[] {
  return Array.isArray(sectionMap.sections) ? sectionMap.sections.filter(isRecord) : [];
}

function lyricRows(lyrics: Record<string, unknown> | null): Record<string, unknown>[] {
  return Array.isArray(lyrics?.sections) ? lyrics.sections.filter(isRecord) : [];
}

function sceneRows(scenePlan: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(scenePlan.scenes) ? scenePlan.scenes.filter(isRecord) : [];
}

function captionRows(captionPlan: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(captionPlan.captions) ? captionPlan.captions.filter(isRecord) : [];
}

function collectStyleTokens(value: unknown): string[] {
  const tokens = new Set<string>();
  collectStrings(value, tokens);
  return [...tokens].filter((token) => /^[a-z0-9_-]{3,40}$/i.test(token)).slice(0, 24).sort();
}

function collectStrings(value: unknown, tokens: Set<string>): void {
  if (typeof value === "string") {
    for (const part of value.split(/[^a-z0-9_-]+/i)) {
      if (part) tokens.add(part);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, tokens);
    return;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) collectStrings(item, tokens);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
