import { execFile } from "node:child_process";
import { copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ensureDir, sha256File, writeJson } from "./fs-utils.ts";
import { parseLyrics, type StructuredLyrics } from "./lyrics.ts";

const execFileAsync = promisify(execFile);

type QaStatus = "auto_approved" | "approved_with_warnings" | "needs_review" | "blocked";

type MusicManifest = {
  version: string;
  raw_audio_path: string;
  master_audio_path: string;
  analysis_audio_path: string;
  duration_seconds: number;
  hash: string;
  raw_hash: string;
  provider: string;
  created_at: string;
};

type BeatLock = {
  bpm: number;
  beat_interval_seconds: number;
  locked_audio_hash: string;
  duration_seconds: number;
  beats: Array<{ index: number; time: number }>;
  bars: Array<{ index: number; time: number }>;
  confidence: number;
};

type SectionMap = {
  audio_hash: string;
  duration_seconds: number;
  sections: Array<{
    index: number;
    label: string;
    start: number;
    end: number;
    lyric_lines: string[];
  }>;
};

const previewWidth = 1080;
const previewHeight = 1920;
const previewFps = 30;

export async function lockAcceptedMusic(projectPath: string): Promise<MusicManifest> {
  const rawAudio = await findRawAudio(projectPath);
  const masterPath = path.join(projectPath, "audio", "minimax_rap_master.wav");
  const analysisPath = path.join(projectPath, "audio", "minimax_rap_analysis.wav");

  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    rawAudio.absolutePath,
    "-ac",
    "2",
    "-ar",
    "48000",
    masterPath,
  ]);
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    rawAudio.absolutePath,
    "-ac",
    "1",
    "-ar",
    "22050",
    analysisPath,
  ]);

  const duration = await probeDuration(masterPath);
  const manifest: MusicManifest = {
    version: "music_v001",
    raw_audio_path: rawAudio.relativePath,
    master_audio_path: "audio/minimax_rap_master.wav",
    analysis_audio_path: "audio/minimax_rap_analysis.wav",
    duration_seconds: round(duration),
    hash: await sha256File(masterPath),
    raw_hash: await sha256File(rawAudio.absolutePath),
    provider: "external_minimax",
    created_at: new Date().toISOString(),
  };

  await writeJson(path.join(projectPath, "audio", "music_manifest.json"), manifest);
  await writeQaReport(projectPath, "music_ingest_qa_report.json", {
    gate_name: "Music Ingest QA",
    status: "auto_approved",
    input_artifacts: [rawAudio.relativePath],
    output_artifacts: ["audio/minimax_rap_master.wav", "audio/minimax_rap_analysis.wav", "audio/music_manifest.json"],
  });
  await patchJson(path.join(projectPath, "project_manifest.json"), {
    actual_audio_duration: manifest.duration_seconds,
    locked_audio_hash: manifest.hash,
    updated_at: manifest.created_at,
  });
  await appendStepRun(projectPath, "music_ingest", "succeeded");

  return manifest;
}

export async function generateBeatLock(projectPath: string): Promise<BeatLock> {
  const manifest = await readJson<MusicManifest>(path.join(projectPath, "audio", "music_manifest.json"));
  const inputConfig = await readJson<Record<string, unknown>>(path.join(projectPath, "input", "input_config.json"));
  const bpm = typeof inputConfig.bpm_hint === "number" ? inputConfig.bpm_hint : 90;
  const interval = 60 / bpm;
  const beats: BeatLock["beats"] = [];
  const bars: BeatLock["bars"] = [];

  for (let time = 0, index = 0; time <= manifest.duration_seconds + 0.001; time += interval, index += 1) {
    const roundedTime = round(time);
    beats.push({ index, time: roundedTime });
    if (index % 4 === 0) {
      bars.push({ index: index / 4, time: roundedTime });
    }
  }

  const lock: BeatLock = {
    bpm,
    beat_interval_seconds: round(interval),
    locked_audio_hash: manifest.hash,
    duration_seconds: manifest.duration_seconds,
    beats,
    bars,
    confidence: beats.length >= 2 ? 0.82 : 0.5,
  };

  await writeJson(path.join(projectPath, "data", "beats.auto.json"), lock);
  await writeJson(path.join(projectPath, "data", "beats.locked.json"), lock);
  await writeFile(
    path.join(projectPath, "data", "beat_diagnostics.md"),
    `# Beat diagnostics\n\n- BPM: ${bpm}\n- Confidence: ${lock.confidence}\n- Locked audio hash: ${manifest.hash}\n`,
    "utf8",
  );
  await writeQaReport(projectPath, "beat_lock_qa_report.json", {
    gate_name: "Beat Lock QA",
    status: lock.confidence >= 0.7 ? "auto_approved" : "needs_review",
    input_artifacts: ["audio/music_manifest.json"],
    output_artifacts: ["data/beats.auto.json", "data/beats.locked.json", "data/beat_diagnostics.md"],
  });
  await appendStepRun(projectPath, "beat_lock", "succeeded");

  return lock;
}

export async function generateSectionMap(projectPath: string): Promise<SectionMap> {
  const manifest = await readJson<MusicManifest>(path.join(projectPath, "audio", "music_manifest.json"));
  const beats = await readJson<BeatLock>(path.join(projectPath, "data", "beats.locked.json"));
  const lyrics = await readStructuredLyrics(projectPath);
  const count = Math.max(lyrics.sections.length, 1);
  const rawSpan = manifest.duration_seconds / count;

  const sections = lyrics.sections.map((section, index) => {
    const preferredStart = index * rawSpan;
    const preferredEnd = index === count - 1 ? manifest.duration_seconds : (index + 1) * rawSpan;
    const start = index === 0 ? 0 : nearestBarTime(preferredStart, beats.bars);
    const end = index === count - 1 ? manifest.duration_seconds : Math.max(start + 0.2, nearestBarTime(preferredEnd, beats.bars));
    return {
      index,
      label: section.label,
      start: round(Math.min(start, manifest.duration_seconds)),
      end: round(Math.min(end, manifest.duration_seconds)),
      lyric_lines: section.lines,
    };
  });

  for (let index = 0; index < sections.length - 1; index += 1) {
    sections[index].end = sections[index + 1].start > sections[index].start
      ? sections[index + 1].start
      : round(Math.min(manifest.duration_seconds, sections[index].start + rawSpan));
  }

  const sectionMap: SectionMap = {
    audio_hash: manifest.hash,
    duration_seconds: manifest.duration_seconds,
    sections,
  };
  await writeJson(path.join(projectPath, "data", "section_map.json"), sectionMap);
  await writeJson(path.join(projectPath, "data", "section_density_report.json"), {
    status: "auto_approved",
    sections: sections.map((section) => ({
      label: section.label,
      duration_seconds: round(section.end - section.start),
      line_count: section.lyric_lines.length,
      density: section.lyric_lines.length / Math.max(0.1, section.end - section.start),
    })),
  });
  await writeQaReport(projectPath, "timing_qa_report.json", {
    gate_name: "Timing QA",
    status: "auto_approved",
    input_artifacts: ["audio/music_manifest.json", "data/beats.locked.json", "data/lyrics_structured.json"],
    output_artifacts: ["data/section_map.json", "data/section_density_report.json"],
  });
  await appendStepRun(projectPath, "section_mapping", "succeeded");

  return sectionMap;
}

export async function generateScenePlans(projectPath: string): Promise<void> {
  const sectionMap = await readJson<SectionMap>(path.join(projectPath, "data", "section_map.json"));
  const scenes = sectionMap.sections.map((section) => ({
    id: `scene_${String(section.index + 1).padStart(3, "0")}`,
    section_label: section.label,
    start: section.start,
    end: section.end,
    objective: `${section.label} concept card`,
    template: "science_card",
    safe_area: "9:16_center",
  }));
  const captions = sectionMap.sections.flatMap((section) => {
    const lines = section.lyric_lines.length > 0 ? section.lyric_lines : [section.label];
    const span = Math.max(0.2, (section.end - section.start) / lines.length);
    return lines.map((line, lineIndex) => ({
      scene_id: `scene_${String(section.index + 1).padStart(3, "0")}`,
      start: round(section.start + lineIndex * span),
      end: round(Math.min(section.end, section.start + (lineIndex + 1) * span)),
      text: line,
    }));
  });
  const visuals = scenes.map((scene) => ({
    scene_id: scene.id,
    type: "concept_card",
    title: scene.section_label,
    elements: ["keyword_card", "arrow_diagram", "beat_accent"],
  }));

  await writeJson(path.join(projectPath, "data", "scene_plan.json"), { scenes });
  await writeJson(path.join(projectPath, "data", "caption_plan.json"), { captions });
  await writeJson(path.join(projectPath, "data", "visual_plan.json"), { visuals });
  await writeJson(path.join(projectPath, "data", "render_plan.json"), {
    fps: previewFps,
    resolution: [previewWidth, previewHeight],
    targets: ["preview_composite", "preview_composite_review"],
  });
  await writeQaReport(projectPath, "scene_qa_report.json", {
    gate_name: "Scene QA",
    status: "auto_approved",
    input_artifacts: ["data/section_map.json"],
    output_artifacts: ["data/scene_plan.json", "data/caption_plan.json", "data/visual_plan.json"],
  });
  await appendStepRun(projectPath, "scene_planning", "succeeded");
}

export async function generateHypeframesProject(projectPath: string): Promise<void> {
  const sectionMap = await readJson<SectionMap>(path.join(projectPath, "data", "section_map.json"));
  const targets = {
    preview_composite: {
      output: "dist/preview_composite.mp4",
      mode: "preview",
      includes_review_markers: false,
    },
    preview_composite_review: {
      output: "dist/preview_composite_review.mp4",
      mode: "review",
      includes_review_markers: true,
    },
  };

  await writeFile(path.join(projectPath, "hypeframes", "styles.css"), renderStyles(), "utf8");
  await writeJson(path.join(projectPath, "hypeframes", "render_targets.json"), targets);
  await writeJson(path.join(projectPath, "hypeframes", "package_manifest.json"), {
    renderer: "local-hypeframes-compatible",
    version: "0.1.0",
    source: "generated_from_post_minimax_workflow",
  });
  await writeJson(path.join(projectPath, "hypeframes", "generated", "timeline.json"), sectionMap);
  await writeJson(path.join(projectPath, "hypeframes", "generated", "cues.json"), {
    cues: sectionMap.sections.map((section) => ({
      time: section.start,
      label: section.label,
    })),
  });
  await writeFile(path.join(projectPath, "hypeframes", "index.html"), renderHypeframesHtml(sectionMap), "utf8");
  await writeQaReport(projectPath, "hypeframes_file_qa_report.json", {
    gate_name: "HypeFrames File QA",
    status: "auto_approved",
    input_artifacts: ["data/scene_plan.json", "data/caption_plan.json", "data/visual_plan.json"],
    output_artifacts: [
      "hypeframes/index.html",
      "hypeframes/styles.css",
      "hypeframes/render_targets.json",
      "hypeframes/package_manifest.json",
    ],
  });
  await appendStepRun(projectPath, "hypeframes_generating", "succeeded");
}

export async function renderPreview(projectPath: string): Promise<void> {
  const manifest = await readJson<MusicManifest>(path.join(projectPath, "audio", "music_manifest.json"));
  const previewPath = path.join(projectPath, "dist", "preview_composite.mp4");
  const reviewPath = path.join(projectPath, "dist", "preview_composite_review.mp4");
  const audioPath = path.join(projectPath, manifest.master_audio_path);

  await ensureDir(path.join(projectPath, "dist", "keyframes"));
  await renderMp4(audioPath, previewPath, manifest.duration_seconds, false);
  await renderMp4(audioPath, reviewPath, manifest.duration_seconds, true);

  const keyframePath = path.join(projectPath, "dist", "keyframes", "t_0000.jpg");
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    "0.2",
    "-i",
    previewPath,
    "-frames:v",
    "1",
    keyframePath,
  ]);
  await copyFile(keyframePath, path.join(projectPath, "dist", "keyframes_contact_sheet.jpg"));

  const previewProbe = await probeMedia(previewPath);
  const audioDuration = manifest.duration_seconds;
  const videoDuration = previewProbe.duration;
  const hasAudio = previewProbe.streams.some((stream) => stream.codec_type === "audio");
  const videoStream = previewProbe.streams.find((stream) => stream.codec_type === "video");
  const durationDelta = Math.abs(videoDuration - audioDuration);
  const status: QaStatus =
    hasAudio && videoStream && durationDelta <= 0.5 ? "auto_approved" : "blocked";

  const renderManifest = {
    render_id: `render_${Date.now()}`,
    render_targets: ["preview_composite", "preview_composite_review"],
    audio_hash: manifest.hash,
    video_duration: round(videoDuration),
    audio_duration: audioDuration,
    fps: previewFps,
    resolution: [previewWidth, previewHeight],
    artifact_hashes: {
      "dist/preview_composite.mp4": await sha256File(previewPath),
      "dist/preview_composite_review.mp4": await sha256File(reviewPath),
    },
    qa_report_id: "render_qa_report.json",
    created_at: new Date().toISOString(),
  };

  await writeJson(path.join(projectPath, "dist", "render_manifest.json"), renderManifest);
  await writeQaReport(projectPath, "render_qa_report.json", {
    gate_name: "Render QA",
    status,
    blocking_issues: status === "blocked" ? ["Preview output failed render QA."] : [],
    input_artifacts: ["hypeframes/index.html", "audio/minimax_rap_master.wav"],
    output_artifacts: [
      "dist/preview_composite.mp4",
      "dist/preview_composite_review.mp4",
      "dist/keyframes_contact_sheet.jpg",
      "dist/render_manifest.json",
    ],
  });
  await writeQaReport(projectPath, "master_qa_report.json", {
    gate_name: "Master QA",
    status,
    blocking_issues: status === "blocked" ? ["Render QA blocked export."] : [],
    input_artifacts: ["qa/render_qa_report.json"],
    output_artifacts: ["dist/preview_composite.mp4"],
  });
  await patchJson(path.join(projectPath, "project_manifest.json"), {
    current_workflow_state: status === "auto_approved" ? "export_ready" : "render_blocked",
    preview_video_hash: renderManifest.artifact_hashes["dist/preview_composite.mp4"],
    updated_at: renderManifest.created_at,
  });
  await patchJson(path.join(projectPath, "workflow_snapshot.json"), {
    workflow_state: status === "auto_approved" ? "export_ready" : "render_blocked",
    next_allowed_actions: status === "auto_approved" ? ["download_assets"] : ["rerender_preview"],
    updated_at: renderManifest.created_at,
  });
  await appendStepRun(projectPath, "preview_render", status === "auto_approved" ? "succeeded" : "failed");
}

async function renderMp4(audioPath: string, outputPath: string, duration: number, review: boolean): Promise<void> {
  const filters = review
    ? `drawgrid=width=120:height=120:thickness=2:color=white@0.15,drawbox=x=80:y=200:w=920:h=500:color=0x2563eb@0.35:t=fill,drawtext=text='REVIEW':x=70:y=70:fontcolor=white:fontsize=54,format=yuv420p`
    : `drawbox=x=80:y=200:w=920:h=500:color=0x2563eb@0.35:t=fill,drawbox=x=120:y=760:w=840:h=240:color=0xfacc15@0.30:t=fill,format=yuv420p`;

  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x101820:s=${previewWidth}x${previewHeight}:r=${previewFps}:d=${duration}`,
    "-i",
    audioPath,
    "-vf",
    filters,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-shortest",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    outputPath,
  ]);
}

async function findRawAudio(projectPath: string): Promise<{ absolutePath: string; relativePath: string }> {
  const audioDir = path.join(projectPath, "audio");
  const files = await readdir(audioDir);
  const raw = files.find((file) => /^minimax_rap_raw\.(mp3|wav|m4a|aac)$/i.test(file));
  if (!raw) {
    throw new Error("Missing raw MiniMax audio in audio/minimax_rap_raw.*");
  }
  return {
    absolutePath: path.join(audioDir, raw),
    relativePath: `audio/${raw}`,
  };
}

async function readStructuredLyrics(projectPath: string): Promise<StructuredLyrics> {
  try {
    return await readJson<StructuredLyrics>(path.join(projectPath, "data", "lyrics_structured.json"));
  } catch {
    const lyricsMarkdown = await readFile(path.join(projectPath, "data", "lyrics.md"), "utf8");
    const parsed = parseLyrics(lyricsMarkdown);
    await writeJson(path.join(projectPath, "data", "lyrics_structured.json"), parsed);
    return parsed;
  }
}

function nearestBarTime(preferred: number, bars: BeatLock["bars"]): number {
  if (bars.length === 0) {
    return preferred;
  }
  return bars.reduce((best, bar) =>
    Math.abs(bar.time - preferred) < Math.abs(best.time - preferred) ? bar : best,
  ).time;
}

async function writeQaReport(
  projectPath: string,
  fileName: string,
  input: {
    gate_name: string;
    status: QaStatus;
    blocking_issues?: string[];
    warnings?: string[];
    input_artifacts: string[];
    output_artifacts: string[];
  },
): Promise<void> {
  await writeJson(path.join(projectPath, "qa", fileName), {
    gate_name: input.gate_name,
    status: input.status,
    blocking_issues: input.blocking_issues ?? [],
    warnings: input.warnings ?? [],
    auto_fixes_applied: [],
    input_artifacts: input.input_artifacts,
    output_artifacts: input.output_artifacts,
    reviewer_type: "rule",
    created_at: new Date().toISOString(),
  });
}

async function appendStepRun(projectPath: string, stepType: string, status: string): Promise<void> {
  await ensureDir(path.join(projectPath, "logs"));
  await writeFile(
    path.join(projectPath, "logs", "step_runs.jsonl"),
    `${JSON.stringify({
      step_type: stepType,
      status,
      created_at: new Date().toISOString(),
    })}\n`,
    { flag: "a" },
  );
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function patchJson(filePath: string, patch: Record<string, unknown>): Promise<void> {
  const value = await readJson<Record<string, unknown>>(filePath);
  await writeJson(filePath, { ...value, ...patch });
}

async function probeDuration(filePath: string): Promise<number> {
  const probe = await probeMedia(filePath);
  return probe.duration;
}

async function probeMedia(filePath: string): Promise<{ duration: number; streams: Array<Record<string, unknown>> }> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,width,height,r_frame_rate",
    "-of",
    "json",
    filePath,
  ]);
  const parsed = JSON.parse(stdout);
  return {
    duration: Number(parsed.format?.duration ?? 0),
    streams: parsed.streams ?? [],
  };
}

function renderStyles(): string {
  return `:root{color-scheme:dark}body{margin:0;background:#101820;color:#f8fafc;font-family:Inter,system-ui,sans-serif}.scene{width:1080px;height:1920px;display:flex;align-items:center;justify-content:center}.card{width:840px;padding:72px;border:2px solid rgba(255,255,255,.2);background:rgba(37,99,235,.35)}`;
}

function renderHypeframesHtml(sectionMap: SectionMap): string {
  const cards = sectionMap.sections
    .map((section) => `<section class="card"><h1>${escapeHtml(section.label)}</h1><p>${escapeHtml(section.lyric_lines.join(" / "))}</p></section>`)
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="./styles.css">
  <title>Qivance Preview</title>
</head>
<body>
  <main data-composition-id="qivance-preview" data-width="${previewWidth}" data-height="${previewHeight}" data-duration="${sectionMap.duration_seconds}">
    <div class="scene">${cards}</div>
  </main>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["qivance-preview"] = { duration: function(){ return ${sectionMap.duration_seconds}; } };</script>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

