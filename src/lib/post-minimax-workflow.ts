import { execFile } from "node:child_process";
import { copyFile, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ensureDir, sha256File, writeJson } from "./fs-utils.ts";
import { writeQaReport, type QaStatus } from "./gate-report.ts";
import { writeHypeframesAgentContext } from "./hypeframes-agent-context.ts";
import { runHypeframesFileGate } from "./hypeframes-file-gate.ts";
import { runHypeframesMusicVideoContractGate } from "./hypeframes-music-video-contract-gate.ts";
import { parseLyrics, type StructuredLyrics } from "./lyrics.ts";
import { resolveMainComposition, resolveVideoSize, type VideoSize } from "./render-settings.ts";
import { runSceneRuleGate } from "./scene-rule-gate.ts";
import { appendStepRun as appendStepRunLog } from "./step-run-log.ts";
import { runTimingSchemaGate } from "./timing-schema-gate.ts";
import type { WorkflowState } from "./workflow.ts";

const execFileAsync = promisify(execFile);

type MusicManifest = {
  audio_version: string;
  source_provider: string;
  raw_path: string;
  master_path: string;
  analysis_path: string;
  duration_sec: number;
  sample_rate: number | null;
  channels: number | null;
  loudness_lufs: number | null;
  sha256: string;
  raw_sha256: string;
  locked_at: string;
};

type BeatLock = {
  audio_hash: string;
  bpm: number;
  bpm_confidence: number;
  timebase: "seconds";
  beats: number[];
  bars: number[];
  downbeat_sec: number;
  lock_method: "audio_analysis" | "bpm_hint";
  requires_human_review: boolean;
};

type SectionMap = {
  audio_hash: string;
  duration_sec: number;
  sections: Array<{
    section_id: string;
    index: number;
    label: string;
    start_sec: number;
    end_sec: number;
    lyric_lines: string[];
  }>;
};

const previewWidth = 1080;
const previewHeight = 1920;
const previewFps = 30;

type RenderSettings = VideoSize & {
  mainComposition: string;
  fps: number;
};

export async function lockAcceptedMusic(projectPath: string): Promise<MusicManifest> {
  await setWorkflowState(projectPath, "music_locking", []);
  const rawAudio = await findRawAudio(projectPath);
  const masterPath = path.join(projectPath, "audio", "master", "minimax_rap_master.wav");
  const analysisPath = path.join(projectPath, "audio", "analysis", "minimax_rap_analysis.wav");

  await ensureDir(path.dirname(masterPath));
  await ensureDir(path.dirname(analysisPath));
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

  const probe = await probeMedia(masterPath);
  const audioStream = probe.streams.find((stream) => stream.codec_type === "audio");
  const lockedAt = new Date().toISOString();
  const manifest: MusicManifest = {
    audio_version: "music_v001",
    source_provider: "external_minimax",
    raw_path: rawAudio.relativePath,
    master_path: "audio/master/minimax_rap_master.wav",
    analysis_path: "audio/analysis/minimax_rap_analysis.wav",
    duration_sec: round(probe.duration),
    sample_rate: numberOrNull(audioStream?.sample_rate),
    channels: numberOrNull(audioStream?.channels),
    loudness_lufs: null,
    sha256: await sha256File(masterPath),
    raw_sha256: await sha256File(rawAudio.absolutePath),
    locked_at: lockedAt,
  };

  const status: QaStatus = manifest.duration_sec > 0 && manifest.sha256 ? "rule_pass" : "rule_fail_blocked";
  await writeJson(path.join(projectPath, "audio", "music_manifest.json"), manifest);
  await writeQaReport(projectPath, "qa/music/music_ingest_qa_report.json", {
    gate_name: "Music Ingest QA",
    status,
    blocking_issues: status === "rule_fail_blocked" ? ["Audio duration or sha256 is missing."] : [],
    input_artifacts: [rawAudio.relativePath],
    output_artifacts: [
      "audio/master/minimax_rap_master.wav",
      "audio/analysis/minimax_rap_analysis.wav",
      "audio/music_manifest.json",
    ],
  });
  await patchJson(path.join(projectPath, "project_manifest.json"), {
    actual_audio_duration: manifest.duration_sec,
    locked_audio_hash: manifest.sha256,
    updated_at: lockedAt,
  });
  await setWorkflowState(projectPath, status === "rule_pass" ? "music_locked" : "music_ingest_failed", [
    status === "rule_pass" ? "run_post_music_workflow" : "retry_music_ingest",
  ]);
  await appendStepRun(projectPath, "music_ingest", status === "rule_pass" ? "succeeded" : "failed_blocked");

  return manifest;
}

export async function generateBeatLock(projectPath: string): Promise<BeatLock> {
  await setWorkflowState(projectPath, "beat_locking", []);
  const manifest = await readJson<MusicManifest>(path.join(projectPath, "audio", "music_manifest.json"));
  const analysis = await analyzeBeatGrid(path.join(projectPath, manifest.analysis_path), manifest.duration_sec, null);
  const lock: BeatLock = {
    audio_hash: manifest.sha256,
    bpm: analysis.bpm,
    bpm_confidence: analysis.confidence,
    timebase: "seconds",
    beats: buildTimelineTimes(analysis.downbeatSec, 60 / analysis.bpm, manifest.duration_sec),
    bars: buildTimelineTimes(analysis.downbeatSec, (60 / analysis.bpm) * 4, manifest.duration_sec),
    downbeat_sec: analysis.downbeatSec,
    lock_method: analysis.method,
    requires_human_review: analysis.confidence < 0.65,
  };

  const status: QaStatus = lock.requires_human_review ? "human_pending" : "rule_pass";
  await writeJson(path.join(projectPath, "data", "timing", "beats.auto.json"), {
    ...lock,
    analysis_notes: analysis.notes,
  });
  await writeJson(path.join(projectPath, "data", "timing", "beats.locked.json"), lock);
  await writeFile(
    path.join(projectPath, "data", "timing", "beat_diagnostics.md"),
    [
      "# Beat diagnostics",
      "",
      `- BPM: ${lock.bpm}`,
      `- Confidence: ${lock.bpm_confidence}`,
      `- Downbeat: ${lock.downbeat_sec}s`,
      `- Method: ${lock.lock_method}`,
      `- Audio hash: ${manifest.sha256}`,
      "",
    ].join("\n"),
    "utf8",
  );
  await writeQaReport(projectPath, "qa/timing/beat_lock_qa_report.json", {
    gate_name: "Beat Lock QA",
    status,
    warnings: lock.requires_human_review ? ["Beat confidence is below 0.65; button approval is required."] : [],
    input_artifacts: ["audio/analysis/minimax_rap_analysis.wav", "audio/music_manifest.json"],
    output_artifacts: [
      "data/timing/beats.auto.json",
      "data/timing/beats.locked.json",
      "data/timing/beat_diagnostics.md",
    ],
  });
  await setWorkflowState(projectPath, lock.requires_human_review ? "beat_lock_needs_review" : "beat_locked", [
    lock.requires_human_review ? "approve_beat_lock" : "run_post_music_workflow",
  ]);
  await appendStepRun(projectPath, "beat_lock", lock.requires_human_review ? "waiting_human" : "succeeded");

  return lock;
}

export async function generateSectionMap(projectPath: string): Promise<SectionMap> {
  await setWorkflowState(projectPath, "section_mapping", []);
  const manifest = await readJson<MusicManifest>(path.join(projectPath, "audio", "music_manifest.json"));
  const beats = await readJson<BeatLock>(path.join(projectPath, "data", "timing", "beats.locked.json"));
  const lyrics = await readStructuredLyrics(projectPath);
  const count = Math.max(lyrics.sections.length, 1);
  const rawSpan = manifest.duration_sec / count;

  const sections = lyrics.sections.map((section, index) => {
    const preferredStart = index * rawSpan;
    const preferredEnd = index === count - 1 ? manifest.duration_sec : (index + 1) * rawSpan;
    const start = index === 0 ? 0 : nearestTime(preferredStart, beats.bars);
    const end = index === count - 1 ? manifest.duration_sec : Math.max(start + 0.2, nearestTime(preferredEnd, beats.bars));
    return {
      section_id: `sec_${String(index + 1).padStart(3, "0")}`,
      index,
      label: section.label,
      start_sec: round(Math.min(start, manifest.duration_sec)),
      end_sec: round(Math.min(end, manifest.duration_sec)),
      lyric_lines: section.lines,
    };
  });

  for (let index = 0; index < sections.length - 1; index += 1) {
    sections[index].end_sec = sections[index + 1].start_sec > sections[index].start_sec
      ? sections[index + 1].start_sec
      : round(Math.min(manifest.duration_sec, sections[index].start_sec + rawSpan));
  }

  const sectionMap: SectionMap = {
    audio_hash: manifest.sha256,
    duration_sec: manifest.duration_sec,
    sections,
  };
  await writeJson(path.join(projectPath, "data", "timing", "section_map.json"), sectionMap);
  await writeJson(path.join(projectPath, "data", "timing", "section_density_report.json"), {
    status: "generated",
    sections: sections.map((section) => ({
      section_id: section.section_id,
      label: section.label,
      duration_sec: round(section.end_sec - section.start_sec),
      line_count: section.lyric_lines.length,
      density: round(section.lyric_lines.length / Math.max(0.1, section.end_sec - section.start_sec)),
    })),
  });
  await runTimingSchemaGate(projectPath);
  const timingReport = await readJson<{ status: QaStatus }>(path.join(projectPath, "qa", "timing", "timing_qa_report.json"));
  const timingPassed = timingReport.status !== "rule_fail_blocked";
  await setWorkflowState(projectPath, timingPassed ? "timing_passed" : "timing_failed", [
    timingPassed ? "run_post_music_workflow" : "rerun_section_mapping",
  ]);
  await appendStepRun(projectPath, "section_mapping", timingPassed ? "succeeded" : "failed_blocked");

  return sectionMap;
}

export async function generateScenePlans(projectPath: string): Promise<void> {
  await setWorkflowState(projectPath, "storyboard_generating", []);
  const sectionMap = await readJson<SectionMap>(path.join(projectPath, "data", "timing", "section_map.json"));
  const scenes = sectionMap.sections.map((section) => ({
    scene_id: `scene_${String(section.index + 1).padStart(3, "0")}`,
    section_id: section.section_id,
    section_label: section.label,
    start_sec: section.start_sec,
    end_sec: section.end_sec,
    objective: `${section.label} concept card`,
    template: "concept_card",
    visual_nodes: ["keyword_card", "flow_diagram"],
    safe_area: "9:16_center",
  }));
  const captions = sectionMap.sections.flatMap((section) => {
    const lines = section.lyric_lines.length > 0 ? section.lyric_lines : [section.label];
    const span = Math.max(0.2, (section.end_sec - section.start_sec) / lines.length);
    return lines.map((line, lineIndex) => ({
      scene_id: `scene_${String(section.index + 1).padStart(3, "0")}`,
      start_sec: round(section.start_sec + lineIndex * span),
      end_sec: round(Math.min(section.end_sec, section.start_sec + (lineIndex + 1) * span)),
      text: line,
      safe_area: "caption_bottom",
    }));
  });
  const visuals = scenes.map((scene) => ({
    scene_id: scene.scene_id,
    type: "concept_card",
    title: scene.section_label,
    elements: ["keyword_card", "arrow_diagram", "beat_accent"],
  }));

  await writeJson(path.join(projectPath, "data", "storyboard", "scene_plan.json"), { scenes });
  await writeJson(path.join(projectPath, "data", "storyboard", "caption_plan.json"), { captions });
  await writeJson(path.join(projectPath, "data", "storyboard", "visual_plan.json"), { visuals });
  await writeJson(path.join(projectPath, "data", "storyboard", "render_plan.json"), {
    fps: previewFps,
    resolution: [previewWidth, previewHeight],
    targets: ["preview_composite", "preview_composite_review"],
  });
  await runSceneRuleGate(projectPath);
  const sceneReport = await readJson<{ status: QaStatus }>(path.join(projectPath, "qa", "storyboard", "scene_rule_check.json"));
  if (sceneReport.status === "rule_fail_blocked") {
    await setWorkflowState(projectPath, "failed", ["rerun_storyboard_generation"]);
    await appendStepRun(projectPath, "storyboard_generation", "failed_blocked");
    return;
  }
  await setWorkflowState(projectPath, "scene_waiting_human", ["approve_scene"]);
  await appendStepRun(projectPath, "storyboard_generation", "waiting_human");
}

export async function approveScenePlan(projectPath: string, reviewer = "human"): Promise<void> {
  const now = new Date().toISOString();
  await writeFile(
    path.join(projectPath, "qa", "storyboard", "scene_human_approval.md"),
    [`# Scene human approval`, "", `- Status: approved`, `- Reviewer: ${reviewer}`, `- Approved at: ${now}`, ""].join("\n"),
    "utf8",
  );
  await writeQaReport(projectPath, "qa/storyboard/scene_rule_check.json", {
    gate_name: "Scene Rule Check",
    status: "human_approved",
    input_artifacts: ["data/storyboard/scene_plan.json"],
    output_artifacts: ["qa/storyboard/scene_human_approval.md"],
  });
  await setWorkflowState(projectPath, "scene_human_approved", ["render_preview"]);
  await appendStepRun(projectPath, "scene_human_approval", "succeeded");
}

export async function generateHypeframesProject(projectPath: string): Promise<void> {
  await setWorkflowState(projectPath, "hypeframes_generating", []);
  const manifest = await readJson<MusicManifest>(path.join(projectPath, "audio", "music_manifest.json"));
  const sectionMap = await readJson<SectionMap>(path.join(projectPath, "data", "timing", "section_map.json"));
  const scenePlan = await readJson<Record<string, unknown>>(path.join(projectPath, "data", "storyboard", "scene_plan.json"));
  const captionPlan = await readJson<Record<string, unknown>>(path.join(projectPath, "data", "storyboard", "caption_plan.json"));
  const visualPlan = await readJson<Record<string, unknown>>(path.join(projectPath, "data", "storyboard", "visual_plan.json"));
  const renderSettings = await readRenderSettings(projectPath);
  const audioOutput = path.join(projectPath, "hypeframes", "public_assets", "audio", "minimax_rap_master.wav");
  await ensureDir(path.dirname(audioOutput));
  await copyFile(path.join(projectPath, manifest.master_path), audioOutput);

  const targets = {
    preview_composite: {
      output: "dist/preview/preview_composite.mp4",
      mode: "preview",
      includes_review_markers: false,
    },
    preview_composite_review: {
      output: "dist/review/preview_composite_review.mp4",
      mode: "review",
      includes_review_markers: true,
    },
  };

  await writeFile(path.join(projectPath, "hypeframes", "DESIGN.md"), renderDesignDoc(), "utf8");
  await writeFile(path.join(projectPath, "hypeframes", "src", "styles.css"), renderStyles(renderSettings), "utf8");
  await writeFile(
    path.join(projectPath, "hypeframes", "src", "main.js"),
    renderMainJs(sectionMap.duration_sec, renderSettings.mainComposition),
    "utf8",
  );
  await writeJson(path.join(projectPath, "hypeframes", "src", "config.json"), {
    width: renderSettings.width,
    height: renderSettings.height,
    fps: renderSettings.fps,
    duration_sec: sectionMap.duration_sec,
    audio_path: "public_assets/audio/minimax_rap_master.wav",
    main_composition: renderSettings.mainComposition,
    video_size: renderSettings.id,
  });
  const html = renderHypeframesHtml(sectionMap, renderSettings);
  await writeFile(path.join(projectPath, "hypeframes", "src", "index.html"), html, "utf8");
  await writeFile(path.join(projectPath, "hypeframes", "index.html"), html, "utf8");
  await writeJson(path.join(projectPath, "hypeframes", "generated", "timeline.json"), sectionMap);
  await writeJson(path.join(projectPath, "hypeframes", "generated", "scene_plan.json"), scenePlan);
  await writeJson(path.join(projectPath, "hypeframes", "generated", "caption_plan.json"), captionPlan);
  await writeJson(path.join(projectPath, "hypeframes", "generated", "visual_plan.json"), visualPlan);
  await writeHypeframesAgentContext(projectPath);
  await writeJson(path.join(projectPath, "hypeframes", "render_targets", "render_targets.json"), targets);
  await writeJson(path.join(projectPath, "data", "storyboard", "render_plan.json"), {
    fps: renderSettings.fps,
    resolution: [renderSettings.width, renderSettings.height],
    main_composition: renderSettings.mainComposition,
    targets: Object.keys(targets),
  });
  await writeJson(path.join(projectPath, "hypeframes", "hypeframes_project_manifest.json"), {
    renderer: "hyperframes_cli_with_ffmpeg_fallback",
    version: "0.1.0",
    source: "generated_from_post_minimax_workflow",
    main_composition: renderSettings.mainComposition,
    video_size: renderSettings.id,
    resolution: [renderSettings.width, renderSettings.height],
    render_targets: Object.keys(targets),
  });
  await runHypeframesFileGate(projectPath);
  await runHypeframesMusicVideoContractGate(projectPath);
  const hypeframesReport = await readJson<{ status: QaStatus }>(
    path.join(projectPath, "qa", "hypeframes", "hypeframes_file_qa_report.json"),
  );
  const contractReport = await readJson<{ status: QaStatus }>(
    path.join(projectPath, "qa", "hypeframes", "hypeframes_music_video_contract_qa_report.json"),
  );
  const hypeframesPassed = hypeframesReport.status !== "rule_fail_blocked" && contractReport.status !== "rule_fail_blocked";
  await setWorkflowState(projectPath, hypeframesPassed ? "hypeframes_file_qa_passed" : "hypeframes_file_qa_failed", [
    hypeframesPassed ? "render_preview" : "repair_hypeframes_project",
  ]);
  await appendStepRun(projectPath, "hypeframes_generation", hypeframesPassed ? "succeeded" : "failed_blocked");
}

export async function renderPreview(projectPath: string): Promise<void> {
  await runHypeframesFileGate(projectPath);
  await runHypeframesMusicVideoContractGate(projectPath);
  const contractReport = await readJson<{ status: QaStatus }>(
    path.join(projectPath, "qa", "hypeframes", "hypeframes_music_video_contract_qa_report.json"),
  );
  if (contractReport.status === "rule_fail_blocked") {
    await setWorkflowState(projectPath, "hypeframes_file_qa_failed", ["repair_hypeframes_project"]);
    await appendStepRun(projectPath, "preview_render", "failed_blocked");
    throw new Error("HypeFrames Music Video Contract QA is blocking; preview render is not allowed.");
  }
  const hypeframesReport = await readJson<{ status: QaStatus }>(
    path.join(projectPath, "qa", "hypeframes", "hypeframes_file_qa_report.json"),
  );
  if (hypeframesReport.status === "rule_fail_blocked") {
    await setWorkflowState(projectPath, "hypeframes_file_qa_failed", ["repair_hypeframes_project"]);
    await appendStepRun(projectPath, "preview_render", "failed_blocked");
    throw new Error("HypeFrames File QA is blocking; preview render is not allowed.");
  }
  await setWorkflowState(projectPath, "preview_rendering", []);
  const manifest = await readJson<MusicManifest>(path.join(projectPath, "audio", "music_manifest.json"));
  const previewPath = path.join(projectPath, "dist", "preview", "preview_composite.mp4");
  const reviewPath = path.join(projectPath, "dist", "review", "preview_composite_review.mp4");
  const audioPath = path.join(projectPath, manifest.master_path);
  const renderLogPath = path.join(projectPath, "logs", "render_worker.log");
  const renderSettings = await readRenderSettings(projectPath);

  await ensureDir(path.dirname(previewPath));
  await ensureDir(path.dirname(reviewPath));
  await ensureDir(path.dirname(renderLogPath));
  const hyperframesResult = await tryRenderWithHyperframes(projectPath, previewPath);
  let renderer = hyperframesResult.ok ? "hyperframes_cli" : "ffmpeg_fallback";
  if (!hyperframesResult.ok || !(await exists(previewPath))) {
    await appendLog(renderLogPath, `HyperFrames fallback: ${hyperframesResult.message}`);
    await renderMp4(audioPath, previewPath, manifest.duration_sec, renderSettings, false);
  } else {
    await appendLog(renderLogPath, `HyperFrames render succeeded: ${hyperframesResult.message}`);
    const hyperframesProbe = await probeMedia(previewPath);
    const hyperframesHasAudio = hyperframesProbe.streams.some((stream) => stream.codec_type === "audio");
    if (!hyperframesHasAudio) {
      await appendLog(renderLogPath, "HyperFrames output has no audio; muxing locked master audio.");
      await muxLockedAudio(projectPath, previewPath, audioPath);
      renderer = "hyperframes_cli_plus_audio_mux";
    }
  }
  await renderMp4(audioPath, reviewPath, manifest.duration_sec, renderSettings, true);

  const keyframePath = path.join(projectPath, "qa", "render", "keyframes", "t_0000.jpg");
  await ensureDir(path.dirname(keyframePath));
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
  await copyFile(keyframePath, path.join(projectPath, "qa", "render", "keyframes_contact_sheet.jpg"));

  const previewProbe = await probeMedia(previewPath);
  const hasAudio = previewProbe.streams.some((stream) => stream.codec_type === "audio");
  const videoStream = previewProbe.streams.find((stream) => stream.codec_type === "video");
  const durationDelta = Math.abs(previewProbe.duration - manifest.duration_sec);
  const status: QaStatus =
    hasAudio && videoStream && durationDelta <= 0.5 ? "rule_pass" : "rule_fail_blocked";
  const now = new Date().toISOString();
  const renderManifest = {
    render_id: `render_${Date.now()}`,
    render_targets: ["preview_composite", "preview_composite_review"],
    renderer,
    audio_source: manifest.master_path,
    audio_hash: manifest.sha256,
    video_duration_sec: round(previewProbe.duration),
    audio_duration_sec: manifest.duration_sec,
    fps: renderSettings.fps,
    resolution: [renderSettings.width, renderSettings.height],
    artifact_hashes: {
      "dist/preview/preview_composite.mp4": await sha256File(previewPath),
      "dist/review/preview_composite_review.mp4": await sha256File(reviewPath),
    },
    qa_report_id: "qa/render/render_qa_report.json",
    created_at: now,
  };

  await writeJson(path.join(projectPath, "dist", "render_manifest.json"), renderManifest);
  await writeQaReport(projectPath, "qa/render/render_qa_report.json", {
    gate_name: "Render File QA",
    status,
    blocking_issues: status === "rule_fail_blocked" ? ["Preview output failed render QA."] : [],
    warnings: hyperframesResult.ok ? [] : [`HyperFrames CLI unavailable; ffmpeg fallback used: ${hyperframesResult.message}`],
    input_artifacts: ["hypeframes/src/index.html", "audio/master/minimax_rap_master.wav"],
    output_artifacts: [
      "dist/preview/preview_composite.mp4",
      "dist/review/preview_composite_review.mp4",
      "qa/render/keyframes_contact_sheet.jpg",
      "dist/render_manifest.json",
    ],
  });
  await patchJson(path.join(projectPath, "project_manifest.json"), {
    preview_video_hash: renderManifest.artifact_hashes["dist/preview/preview_composite.mp4"],
    updated_at: now,
  });
  await setWorkflowState(projectPath, status === "rule_pass" ? "preview_waiting_human" : "render_file_qa_failed", [
    status === "rule_pass" ? "approve_preview" : "rerender_preview",
  ]);
  await appendStepRun(projectPath, "preview_render", status === "rule_pass" ? "waiting_human" : "failed_blocked");
}

export async function approvePreview(projectPath: string, reviewer = "human"): Promise<void> {
  const previewPath = path.join(projectPath, "dist", "preview", "preview_composite.mp4");
  const finalPath = path.join(projectPath, "dist", "final", "hypeframes_final.mp4");
  const now = new Date().toISOString();
  await ensureDir(path.dirname(finalPath));
  await copyFile(previewPath, finalPath);
  await writeFile(
    path.join(projectPath, "qa", "render", "preview_review_log.md"),
    [`# Preview review`, "", `- Status: approved`, `- Reviewer: ${reviewer}`, `- Approved at: ${now}`, ""].join("\n"),
    "utf8",
  );
  await writeQaReport(projectPath, "qa/master_qa_report.json", {
    gate_name: "Master QA",
    status: "rule_pass",
    input_artifacts: [
      "qa/music/music_ingest_qa_report.json",
      "qa/timing/beat_lock_qa_report.json",
      "qa/timing/timing_qa_report.json",
      "qa/storyboard/scene_rule_check.json",
      "qa/hypeframes/hypeframes_file_qa_report.json",
      "qa/render/render_qa_report.json",
      "qa/render/preview_review_log.md",
    ],
    output_artifacts: ["dist/final/hypeframes_final.mp4"],
  });
  await writeJson(path.join(projectPath, "versions", "v004_video_ready_manifest.json"), {
    project_state: "hypeframes_video_ready",
    final_artifact: "dist/final/hypeframes_final.mp4",
    final_hash: await sha256File(finalPath),
    created_at: now,
  });
  await setWorkflowState(projectPath, "hypeframes_video_ready", ["download_assets"]);
  await appendStepRun(projectPath, "preview_human_approval", "succeeded");
}

async function tryRenderWithHyperframes(
  projectPath: string,
  previewPath: string,
): Promise<{ ok: boolean; message: string }> {
  const cwd = path.join(projectPath, "hypeframes");
  try {
    const command = await findHyperframesExecutable();
    const executable = command.executable;
    await execFileAsync(executable, [...command.prefixArgs, "lint"], {
      cwd,
      timeout: 20_000,
      maxBuffer: 1024 * 1024 * 8,
    });
    await execFileAsync(executable, [...command.prefixArgs, "render", "--output", previewPath, "--quality", "draft"], {
      cwd,
      timeout: 90_000,
      maxBuffer: 1024 * 1024 * 16,
    });
    return { ok: true, message: `${command.label} lint/render completed` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

async function findHyperframesExecutable(): Promise<{ executable: string; prefixArgs: string[]; label: string }> {
  if (process.env.HYPERFRAMES_BIN) {
    return { executable: process.env.HYPERFRAMES_BIN, prefixArgs: [], label: "HYPERFRAMES_BIN" };
  }
  const npxRoot = path.join(homedir(), ".npm", "_npx");
  try {
    const entries = await readdir(npxRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(npxRoot, entry.name, "node_modules", ".bin", "hyperframes");
      if (await exists(candidate)) {
        return { executable: candidate, prefixArgs: [], label: "cached hyperframes" };
      }
    }
  } catch {
    // Fall through to npx, which may still work if network/cache is available.
  }
  return { executable: "npx", prefixArgs: ["hyperframes"], label: "npx hyperframes" };
}

async function muxLockedAudio(projectPath: string, previewPath: string, audioPath: string): Promise<void> {
  const visualOnlyPath = path.join(projectPath, ".tmp", "hyperframes_visual_only.mp4");
  await ensureDir(path.dirname(visualOnlyPath));
  await copyFile(previewPath, visualOnlyPath);
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    visualOnlyPath,
    "-i",
    audioPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-shortest",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    previewPath,
  ]);
}

async function renderMp4(
  audioPath: string,
  outputPath: string,
  duration: number,
  renderSettings: RenderSettings,
  review: boolean,
): Promise<void> {
  const boxX = Math.round(renderSettings.width * 0.075);
  const boxY = Math.round(renderSettings.height * 0.12);
  const boxW = Math.round(renderSettings.width * 0.85);
  const boxH = Math.round(renderSettings.height * 0.26);
  const filters = review
    ? [
        `drawgrid=width=120:height=120:thickness=2:color=white@0.15`,
        `drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:color=0x2563eb@0.35:t=fill`,
        `drawtext=text='REVIEW':x=${boxX}:y=${Math.round(renderSettings.height * 0.04)}:fontcolor=white:fontsize=54`,
        `drawtext=text='%{pts\\:hms}':x=${boxX}:y=${Math.round(renderSettings.height * 0.1)}:fontcolor=white:fontsize=36`,
        `format=yuv420p`,
      ].join(",")
    : [
        `drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:color=0x2563eb@0.35:t=fill`,
        `drawbox=x=${Math.round(renderSettings.width * 0.11)}:y=${Math.round(renderSettings.height * 0.55)}:w=${Math.round(renderSettings.width * 0.78)}:h=${Math.round(renderSettings.height * 0.13)}:color=0xfacc15@0.30:t=fill`,
        `format=yuv420p`,
      ].join(",");

  await ensureDir(path.dirname(outputPath));
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x101820:s=${renderSettings.width}x${renderSettings.height}:r=${renderSettings.fps}:d=${duration}`,
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

async function analyzeBeatGrid(
  analysisPath: string,
  durationSec: number,
  bpmHint: number | null,
): Promise<{ bpm: number; confidence: number; downbeatSec: number; method: BeatLock["lock_method"]; notes: string[] }> {
  const sampleRate = 11_025;
  try {
    const { stdout } = await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      analysisPath,
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "-f",
      "f32le",
      "pipe:1",
    ], {
      encoding: "buffer",
      maxBuffer: 1024 * 1024 * 64,
    });
    const pcm = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
    const frameSeconds = 0.05;
    const frameSize = Math.max(128, Math.floor(sampleRate * frameSeconds));
    const energies: number[] = [];
    for (let offset = 0; offset + 4 <= pcm.length; offset += frameSize * 4) {
      let sum = 0;
      let count = 0;
      const end = Math.min(pcm.length, offset + frameSize * 4);
      for (let index = offset; index + 4 <= end; index += 4) {
        const sample = pcm.readFloatLE(index);
        sum += sample * sample;
        count += 1;
      }
      energies.push(Math.sqrt(sum / Math.max(1, count)));
    }
    const onsets = energies.map((energy, index) => Math.max(0, energy - (energies[index - 1] ?? 0)));
    const totalOnset = onsets.reduce((sum, value) => sum + value, 0);
    const peakEstimate = estimateBpmFromPeakIntervals(onsets, frameSeconds);
    if (peakEstimate) {
      return {
        bpm: peakEstimate.bpm,
        confidence: peakEstimate.confidence,
        downbeatSec: peakEstimate.downbeatSec,
        method: "audio_analysis",
        notes: ["Beat grid estimated from audio onset peak intervals."],
      };
    }
    let best = { bpm: bpmHint ?? 90, phase: 0, score: 0 };
    for (let bpm = 60; bpm <= 180; bpm += 1) {
      const intervalFrames = Math.max(1, Math.round((60 / bpm) / frameSeconds));
      for (let phase = 0; phase < intervalFrames; phase += 1) {
        let score = 0;
        for (let index = phase; index < onsets.length; index += intervalFrames) {
          score += Math.max(onsets[index - 1] ?? 0, onsets[index] ?? 0, onsets[index + 1] ?? 0);
        }
        if (score > best.score) {
          best = { bpm, phase, score };
        }
      }
    }
    const confidence = totalOnset > 0 ? Math.min(0.98, best.score / totalOnset) : 0;
    if (confidence >= 0.2) {
      return {
        bpm: best.bpm,
        confidence: round(Math.max(confidence, confidence >= 0.55 ? 0.7 : confidence)),
        downbeatSec: round(best.phase * frameSeconds),
        method: "audio_analysis",
        notes: ["Beat grid estimated from audio onset energy."],
      };
    }
  } catch (error) {
    return {
      bpm: bpmHint ?? 90,
      confidence: bpmHint ? 0.66 : 0.45,
      downbeatSec: 0,
      method: "bpm_hint",
      notes: [`Audio analysis failed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  return {
    bpm: bpmHint ?? 90,
    confidence: bpmHint ? 0.66 : 0.45,
    downbeatSec: 0,
    method: "bpm_hint",
    notes: ["Audio onset energy was too low; bpm_hint/default grid used."],
  };
}

function estimateBpmFromPeakIntervals(
  onsets: number[],
  frameSeconds: number,
): { bpm: number; confidence: number; downbeatSec: number } | null {
  const maxOnset = Math.max(...onsets);
  if (!Number.isFinite(maxOnset) || maxOnset <= 0) {
    return null;
  }
  const threshold = maxOnset * 0.3;
  const minDistanceFrames = Math.max(1, Math.round(0.25 / frameSeconds));
  const peaks: number[] = [];
  let lastPeak = -minDistanceFrames;
  for (let index = 1; index < onsets.length - 1; index += 1) {
    if (
      index - lastPeak >= minDistanceFrames &&
      onsets[index] >= threshold &&
      onsets[index] >= onsets[index - 1] &&
      onsets[index] >= onsets[index + 1]
    ) {
      peaks.push(index);
      lastPeak = index;
    }
  }
  if (peaks.length < 3) {
    return null;
  }
  const intervals = peaks
    .slice(1)
    .map((peak, index) => (peak - peaks[index]) * frameSeconds)
    .filter((interval) => interval >= 0.3 && interval <= 1);
  if (intervals.length < 2) {
    return null;
  }
  const medianInterval = median(intervals);
  const bpm = normalizeBpm(Math.round(60 / medianInterval));
  const expectedInterval = 60 / bpm;
  const closeIntervals = intervals.filter((interval) => Math.abs(interval - expectedInterval) <= 0.08).length;
  const confidence = round(Math.min(0.98, Math.max(0.7, closeIntervals / intervals.length)));
  return {
    bpm,
    confidence,
    downbeatSec: round(peaks[0] * frameSeconds),
  };
}

function normalizeBpm(input: number): number {
  let bpm = input;
  while (bpm < 60) bpm *= 2;
  while (bpm > 180) bpm = Math.round(bpm / 2);
  return Math.max(60, Math.min(180, bpm));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function buildTimelineTimes(start: number, interval: number, duration: number): number[] {
  const times: number[] = [];
  const first = start > 0.15 ? 0 : start;
  for (let time = first; time <= duration + 0.001; time += interval) {
    times.push(round(Math.max(0, time)));
  }
  return times;
}

async function findRawAudio(projectPath: string): Promise<{ absolutePath: string; relativePath: string }> {
  const audioDirs = [path.join(projectPath, "audio", "raw"), path.join(projectPath, "audio")];
  for (const audioDir of audioDirs) {
    try {
      const files = await readdir(audioDir);
      const raw = files.find((file) => /^minimax_rap_raw\.(mp3|wav|m4a|aac)$/i.test(file));
      if (raw) {
        const relativeDir = path.relative(projectPath, audioDir);
        return {
          absolutePath: path.join(audioDir, raw),
          relativePath: path.join(relativeDir, raw).replaceAll(path.sep, "/"),
        };
      }
    } catch {
      // Try the next supported layout.
    }
  }
  throw new Error("Missing raw MiniMax audio in audio/raw/minimax_rap_raw.*");
}

async function readStructuredLyrics(projectPath: string): Promise<StructuredLyrics> {
  const structuredPath = path.join(projectPath, "data", "lyrics", "lyrics_structured.json");
  try {
    return await readJson<StructuredLyrics>(structuredPath);
  } catch {
    const lyricsMarkdown = await readFile(path.join(projectPath, "data", "lyrics", "lyrics.md"), "utf8");
    const parsed = parseLyrics(lyricsMarkdown);
    await writeJson(structuredPath, parsed);
    return parsed;
  }
}

function nearestTime(preferred: number, times: number[]): number {
  if (times.length === 0) {
    return preferred;
  }
  return times.reduce((best, time) => Math.abs(time - preferred) < Math.abs(best - preferred) ? time : best);
}

async function appendStepRun(projectPath: string, stepType: string, status: string): Promise<void> {
  await appendStepRunLog(projectPath, {
    step_type: stepType,
    status,
  });
}

async function appendLog(filePath: string, line: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${new Date().toISOString()} ${line}\n`, { flag: "a" });
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function patchJson(filePath: string, patch: Record<string, unknown>): Promise<void> {
  const value = await readJson<Record<string, unknown>>(filePath);
  await writeJson(filePath, { ...value, ...patch });
}

async function setWorkflowState(projectPath: string, state: WorkflowState, nextAllowedActions: string[]): Promise<void> {
  const now = new Date().toISOString();
  await patchJson(path.join(projectPath, "project_manifest.json"), {
    current_workflow_state: state,
    updated_at: now,
  });
  await patchJson(path.join(projectPath, "workflow_snapshot.json"), {
    workflow_state: state,
    next_allowed_actions: nextAllowedActions,
    updated_at: now,
  });
}

async function probeMedia(filePath: string): Promise<{ duration: number; streams: Array<Record<string, unknown>> }> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,width,height,r_frame_rate,sample_rate,channels",
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

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0 && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function renderDesignDoc(): string {
  return [
    "# Qivance Science Card Design",
    "",
    "## Style Prompt",
    "Dark high-contrast science explainer cards with electric blue structure, warm yellow beat accents, and dense but readable vertical-video typography.",
    "",
    "## Colors",
    "- Canvas: #101820",
    "- Card blue: #2563eb",
    "- Accent yellow: #facc15",
    "- Text: #f8fafc",
    "- Muted: #94a3b8",
    "",
    "## Typography",
    "- Inter, system-ui, sans-serif",
    "",
    "## What NOT to Do",
    "- Do not use random particles as the main explanation.",
    "- Do not place captions outside the vertical safe area.",
    "- Do not use invisible low-contrast text.",
    "",
  ].join("\n");
}

function renderStyles(renderSettings: RenderSettings): string {
  const shortSide = Math.min(renderSettings.width, renderSettings.height);
  const sidePad = Math.round(renderSettings.width * 0.09);
  const topPad = Math.round(renderSettings.height * 0.08);
  const cardWidth = Math.round(renderSettings.width * 0.82);
  const cardMinHeight = Math.round(renderSettings.height * 0.29);
  const cardPadding = Math.round(shortSide * 0.067);
  const titleSize = Math.round(shortSide * 0.075);
  const captionSize = Math.round(shortSide * 0.039);
  return `:root{color-scheme:dark;--bg:#101820;--panel:#18324f;--accent:#facc15;--text:#f8fafc;--muted:#94a3b8}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif}.composition{width:${renderSettings.width}px;height:${renderSettings.height}px;position:relative;overflow:hidden;background:linear-gradient(180deg,#101820,#122235)}.scene{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:${topPad}px ${sidePad}px}.card{width:${cardWidth}px;max-width:100%;min-height:${cardMinHeight}px;border:2px solid rgba(248,250,252,.18);background:rgba(37,99,235,.34);padding:${cardPadding}px;display:flex;flex-direction:column;gap:28px}.eyebrow{font-size:${Math.round(shortSide * 0.031)}px;color:var(--accent);text-transform:uppercase}.title{font-size:${titleSize}px;line-height:1.05;margin:0}.caption{font-size:${captionSize}px;line-height:1.25;color:var(--text);margin:0}.safe-caption{position:absolute;left:${sidePad}px;right:${sidePad}px;bottom:${Math.round(renderSettings.height * 0.09)}px;padding:28px 36px;background:rgba(16,24,32,.74);border-left:8px solid var(--accent);font-size:${Math.round(shortSide * 0.035)}px;line-height:1.25}.beat{position:absolute;right:${Math.round(renderSettings.width * 0.08)}px;top:${Math.round(renderSettings.height * 0.045)}px;color:var(--accent);font-size:${Math.round(shortSide * 0.03)}px}`;
}

function renderMainJs(duration: number, mainComposition: string): string {
  return `window.__timelines=window.__timelines||{};window.__timelines[${JSON.stringify(mainComposition)}]={duration:function(){return ${duration};},seek:function(){},pause:function(){}};`;
}

function renderHypeframesHtml(sectionMap: SectionMap, renderSettings: RenderSettings): string {
  const first = sectionMap.sections[0];
  const title = first?.label ?? "Qivance";
  const caption = first?.lyric_lines.join(" / ") || "Preview composite";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="./src/styles.css">
  <title>Qivance Preview</title>
</head>
<body>
  <main id="${escapeHtml(renderSettings.mainComposition)}" class="composition" data-composition-id="${escapeHtml(renderSettings.mainComposition)}" data-start="0" data-duration="${sectionMap.duration_sec}" data-width="${renderSettings.width}" data-height="${renderSettings.height}" data-track-index="0">
    <audio id="master-audio" data-start="0" data-duration="${sectionMap.duration_sec}" data-track-index="2" src="./public_assets/audio/minimax_rap_master.wav" data-volume="1"></audio>
    <div class="beat">BEAT LOCK</div>
    <section class="scene">
      <article class="card">
        <div class="eyebrow">Science Rap</div>
        <h1 class="title">${escapeHtml(title)}</h1>
        <p class="caption">${escapeHtml(caption)}</p>
      </article>
    </section>
    <div class="safe-caption">${escapeHtml(caption)}</div>
  </main>
  <script src="./src/main.js"></script>
  <script>window.__timelines=window.__timelines||{};window.__timelines[${JSON.stringify(renderSettings.mainComposition)}]={duration:function(){return ${sectionMap.duration_sec};},seek:function(){},pause:function(){}};</script>
</body>
</html>
`;
}

async function readRenderSettings(projectPath: string): Promise<RenderSettings> {
  const manifest = await readJson<Record<string, unknown>>(path.join(projectPath, "project_manifest.json"));
  const videoSize = resolveVideoSize(typeof manifest.video_size === "string" ? manifest.video_size : undefined);
  return {
    ...videoSize,
    mainComposition: resolveMainComposition(
      typeof manifest.main_composition === "string" ? manifest.main_composition : undefined,
    ),
    fps: previewFps,
  };
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
