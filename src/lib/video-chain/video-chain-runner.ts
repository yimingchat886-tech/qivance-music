import { execFile as execFileCallback } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ProjectStore, type Project } from "@html-video/core";
import type { Project as DbProject } from "@prisma/client";
import { resolveSmallProjectPaths, type SmallProjectPaths } from "../project-core/paths.ts";
import type { SectionMapLike } from "../chat-dialogue/line-timing.ts";
import { muxLockedAudio as muxLockedAudioDefault } from "../export/mux-locked-audio.ts";
import { sha256File, writeJson } from "../fs-utils.ts";
import { buildAgentContext } from "../video-contract/agent-context.schema.ts";
import { validateAnimationPlan, type AnimationPlan } from "../video-contract/animation-plan.schema.ts";
import { animationPlanToContentGraph } from "../video-html/animation-plan-to-content-graph.ts";
import { buildCodexFrameAgentPrompt } from "../video-html/codex-frame-agent-prompt.ts";
import { validateFrameOutputs } from "../video-html/frame-output-contract-validator.ts";
import { ensureHtmlVideoWorkspace } from "../video-html/html-video-workspace.ts";
import { runHtmlVideoAgentRuntime as runHtmlVideoAgentRuntimeDefault } from "../video-html/html-video-agent-runtime.ts";
import type { HtmlVideoAgentRuntimeResult } from "../video-html/html-video-agent-runtime.ts";
import { assertAllowedPathChanges, CodexForbiddenFileChangeError, diffSnapshots, snapshotFiles } from "../video-html/path-gate.ts";
import { buildFrameContracts, type QivanceFrameContracts } from "../video-html/qivance-frame-contracts.ts";
import { renderHtmlVideoVisual as renderHtmlVideoVisualDefault } from "../video-html/render-html-video.ts";
import { importSourceVideoAsset, type SourceVideoImportFile, type SourceVideoImportProbe } from "../video-html/source-video-import.ts";
import { buildAgentRunLog, writeAgentRunLog } from "../video-html/agent-run-log.ts";

const execFileAsync = promisify(execFileCallback);

export type VideoChainDeps = {
  probeSourceVideo?: SourceVideoImportProbe;
  runHtmlVideoAgentRuntime?: typeof runHtmlVideoAgentRuntimeDefault;
  renderHtmlVideoVisual?: typeof renderHtmlVideoVisualDefault;
  muxLockedAudio?: typeof muxLockedAudioDefault;
  ffprobeJson?: (filePath: string) => Promise<Record<string, unknown>>;
};

export async function prepareVideoChainContext(project: DbProject, deps: VideoChainDeps = {}): Promise<void> {
  const sourceImport = await ensureBackgroundVideoImport(project, deps);
  const sectionMap = await readProjectJson<SectionMapLike>(project.projectRoot, "data/timing/section_map.json");
  const lyricsText = await readFile(path.join(project.projectRoot, "lyrics.md"), "utf8");
  const animationPlan = buildVideoChainAnimationPlan({
    project,
    sectionMap,
    lyricsText,
    sourceImport,
  });
  const validation = validateAnimationPlan(animationPlan);
  if (!validation.ok) throw new Error(`video_animation_plan_invalid: ${validation.issues.join("; ")}`);
  await writeJson(path.join(project.projectRoot, "data/chains/video_chain/video_animation_plan.json"), animationPlan);
}

export async function buildVideoChainFrames(project: DbProject, deps: VideoChainDeps = {}): Promise<void> {
  const paths = projectPaths(project);
  const sourceImport = await readProjectJson<SourceVideoImportFile>(project.projectRoot, "data/source/source_video_import.json");
  const animationPlan = await readProjectJson<AnimationPlan>(project.projectRoot, "data/chains/video_chain/video_animation_plan.json");
  const frameContracts = withMp3MasterAudio(buildFrameContracts({ plan: animationPlan, paths }));
  await ensureHtmlVideoWorkspace({
    paths,
    animationPlan,
    contentGraph: animationPlanToContentGraph(animationPlan),
    frameContracts,
  });
  await writeJson(paths.frameContractsPath, frameContracts);
  await writeVideoChainAgentContext(paths, animationPlan, sourceImport);
  await stageBackgroundVideoForFrames(paths, sourceImport);
  await writeFile(paths.codexPromptPath, `${buildCodexFrameAgentPrompt({
    smallProjectId: paths.smallProjectId,
    agentContextPath: "codex/agent_context.json",
    contentGraphPath: "content-graph.json",
    frameContractsPath: "qivance-frame-contracts.json",
  })}
V6 video_chain requirements:
- Treat sourceVideo.path as a full-frame muted background video layer in every frame.
- Do not use the source video's audio. The final master audio is active_music_take.mp3.
- Add animated knowledge cards, teaching callouts, keyword pops, and lyric/timing-aware overlays above the background video.
- Keep text readable and inside the frame. Do not use remote assets.
`, "utf8");

  const startedAt = new Date().toISOString();
  const before = await snapshotFiles(paths.htmlVideoProjectDir);
  const runtime = await runAgentRuntime(paths, deps);
  await writeJson(path.join(paths.codexDir, "video-chain-runtime-result.json"), runtime);
  const finishedAt = new Date().toISOString();
  const changedFiles = diffSnapshots(before, await snapshotFiles(paths.htmlVideoProjectDir));
  const forbiddenChangedFiles = forbiddenPathChanges(changedFiles);
  const frameValidation = await validateFrameOutputs({
    framesDir: paths.framesDir,
    contracts: frameContracts,
    allowedLocalImagePaths: [],
    allowedLocalVideoPaths: [sourceImport.source_video.path],
  });
  const validationIssues = [
    ...frameValidation.issues,
    ...await validateVideoChainBackgroundFrames({
      paths,
      contracts: frameContracts,
      sourceVideoPath: sourceImport.source_video.path,
    }),
  ];
  const log = buildAgentRunLog({
    smallProjectId: paths.smallProjectId,
    mode: "production",
    operation: "run_agent",
    startedAt,
    finishedAt,
    exitCode: runtime.exitCode,
    timedOut: runtime.timedOut,
    changedFiles,
    frameValidation: { passed: validationIssues.length === 0, issues: validationIssues },
    forbiddenChangedFiles,
    diagnostics: runtimeDiagnostics(runtime),
    inputArtifacts: [
      "content-graph.json",
      "qivance-frame-contracts.json",
      "codex/agent_context.json",
      "data/chains/video_chain/video_animation_plan.json",
      "data/source/source_video_import.json",
    ],
  });
  await writeAgentRunLog({ paths, log });
  if (!log.validation.passed) {
    throw new Error(`video_chain_agent_failed: ${log.validation.issues.join("; ")}`);
  }
  await syncProjectFramesFromContracts(paths, frameContracts);
  await copyChainFrameContracts(project.projectRoot, frameContracts);
}

export async function renderVideoChainVisual(project: DbProject, deps: VideoChainDeps = {}): Promise<void> {
  await (deps.renderHtmlVideoVisual ?? renderHtmlVideoVisualDefault)({
    paths: projectPaths(project),
    outputPath: path.join(project.projectRoot, "exports/video_chain/visual.mp4"),
  });
}

export async function muxVideoChainFinal(project: DbProject, deps: VideoChainDeps = {}): Promise<void> {
  await (deps.muxLockedAudio ?? muxLockedAudioDefault)({
    visualMp4Path: path.join(project.projectRoot, "exports/video_chain/visual.mp4"),
    masterAudioPath: path.join(project.projectRoot, "active_music_take.mp3"),
    finalMp4Path: path.join(project.projectRoot, "exports/video_chain/final.mp4"),
  });
}

export async function writeVideoChainQaReport(project: DbProject, deps: VideoChainDeps = {}): Promise<void> {
  const finalProbe = await ffprobeJson(path.join(project.projectRoot, "exports/video_chain/final.mp4"), deps);
  const audioProbe = await ffprobeJson(path.join(project.projectRoot, "active_music_take.mp3"), deps);
  const audioStreamCount = streamCount(finalProbe, "audio");
  const durationDriftMs = Math.round(Math.abs(probeDurationSec(finalProbe) - probeDurationSec(audioProbe)) * 1000);
  if (audioStreamCount !== 1) throw new Error(`video_chain_audio_stream_invalid: final.mp4 must have exactly one audio stream, got ${audioStreamCount}.`);
  if (durationDriftMs > 150) throw new Error(`video_chain_duration_drift: final.mp4 duration drift ${durationDriftMs}ms exceeds 150ms.`);
  await writeJson(path.join(project.projectRoot, "data/chains/video_chain/qa_report.json"), {
    schema_version: 1,
    chain_id: "video_chain",
    status: "passed",
    audio_policy: "mp3_master_audio",
    audio_stream_count: audioStreamCount,
    duration_drift_ms: durationDriftMs,
    ffprobe: finalProbe,
  });
}

export async function writeVideoChainManifest(project: DbProject, runId: string, deps: VideoChainDeps = {}): Promise<void> {
  const sourceImport = await readProjectJson<SourceVideoImportFile>(project.projectRoot, "data/source/source_video_import.json");
  const finalProbe = await ffprobeJson(path.join(project.projectRoot, "exports/video_chain/final.mp4"), deps);
  const audioProbe = await ffprobeJson(path.join(project.projectRoot, "active_music_take.mp3"), deps);
  const manifest = {
    schema_version: 6,
    mode: "production",
    chain: {
      id: "video_chain",
      run_id: runId,
      animation_plan: await evidenceRef(project.projectRoot, "data/chains/video_chain/video_animation_plan.json"),
      frame_contracts: await evidenceRef(project.projectRoot, "data/chains/video_chain/frame_contracts.json"),
    },
    inputs: {
      lyrics: await evidenceRef(project.projectRoot, "lyrics.md"),
      audio: await evidenceRef(project.projectRoot, "active_music_take.mp3"),
      background_video: {
        ...await evidenceRef(project.projectRoot, "source_video.mp4"),
        audio_policy: "ignore_source_audio",
        ffprobe: sourceImport.source_video.ffprobe,
      },
      timing: {
        beat_grid: await evidenceRef(project.projectRoot, "data/timing/beat_grid.json"),
        onset_events: await evidenceRef(project.projectRoot, "data/timing/onset_events.json"),
        energy_curve: await evidenceRef(project.projectRoot, "data/timing/energy_curve.json"),
        lyric_word_timing: await evidenceRef(project.projectRoot, "data/timing/lyric_word_timing.json"),
        alignment_report: await evidenceRef(project.projectRoot, "data/timing/alignment_report.json"),
        section_map: await evidenceRef(project.projectRoot, "data/timing/section_map.json"),
      },
    },
    outputs: {
      visual: await evidenceRef(project.projectRoot, "exports/video_chain/visual.mp4"),
      final: await evidenceRef(project.projectRoot, "exports/video_chain/final.mp4"),
    },
    qa: {
      ffprobe: finalProbe,
      duration_drift_ms: Math.round(Math.abs(probeDurationSec(finalProbe) - probeDurationSec(audioProbe)) * 1000),
      audio_stream_count: streamCount(finalProbe, "audio"),
      final_audio_source: "active_music_take.mp3",
    },
    production_gates: {
      fallback_frames_used: false,
      diagnostic_only: false,
      remote_resources_used: false,
      html_video_agent_required: true,
    },
  };
  await writeJson(path.join(project.projectRoot, "exports/video_chain/render_manifest.json"), manifest);
}

export async function validateVideoChainBackgroundFrames(input: {
  paths: SmallProjectPaths;
  contracts: QivanceFrameContracts;
  sourceVideoPath: string;
}): Promise<string[]> {
  const issues: string[] = [];
  const frames = Object.values(input.contracts.frames).sort((a, b) => a.order - b.order);
  for (const frame of frames) {
    const framePath = path.join(input.paths.framesDir, path.basename(frame.allowedHtmlPath));
    let html: string;
    try {
      html = await readFile(framePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        issues.push(`${frame.allowedHtmlPath}: missing frame for background video validation`);
        continue;
      }
      throw error;
    }
    if (!videoSources(html).includes(input.sourceVideoPath)) {
      issues.push(`${frame.allowedHtmlPath}: missing locked background video ${input.sourceVideoPath}`);
    }
  }
  return issues;
}

async function ensureBackgroundVideoImport(project: DbProject, deps: VideoChainDeps): Promise<SourceVideoImportFile> {
  const existing = await readOptionalProjectJson<SourceVideoImportFile>(project.projectRoot, "data/source/source_video_import.json");
  if (existing?.status === "locked" && existing.audio_policy === "background_video_only") return existing;
  const result = await importSourceVideoAsset({
    projectRoot: project.projectRoot,
    smallProjectId: project.id,
    sourcePath: "source_video.mp4",
    copyToProject: false,
    audioPolicy: "background_video_only",
    ...(deps.probeSourceVideo ? { probe: deps.probeSourceVideo } : {}),
  });
  return result.importFile;
}

function buildVideoChainAnimationPlan(input: {
  project: DbProject;
  sectionMap: SectionMapLike;
  lyricsText: string;
  sourceImport: SourceVideoImportFile;
}): AnimationPlan {
  const lyricLines = extractLyricLines(input.lyricsText);
  const sections = (input.sectionMap.sections.length > 0 ? input.sectionMap.sections : [{
    section_id: "sec_001",
    start_sec: 0,
    end_sec: Math.max(1, input.sectionMap.duration_sec ?? input.sourceImport.source_video.duration_sec),
  }]);
  const durationSec = sections.reduce((sum, section) => sum + Math.max(0, section.end_sec - section.start_sec), 0);
  return {
    schemaVersion: 1,
    smallProjectId: input.project.id,
    title: input.project.title,
    category: "ai_concept",
    targetDurationSec: round(durationSec),
    fps: 30,
    resolution: {
      width: input.sourceImport.source_video.width || 1080,
      height: input.sourceImport.source_video.height || 1920,
    },
    aspectRatio: aspectRatio(input.sourceImport.source_video.width, input.sourceImport.source_video.height),
    mood: "instructional kinetic cards over background video",
    synopsis: "Knowledge-card overlays synchronized to lyrics over a locked MP4 background.",
    scenes: sections.map((section, index) => {
      const headline = lyricLines[index * 2] ?? `Knowledge Card ${index + 1}`;
      return {
        id: `video_card_${String(index + 1).padStart(3, "0")}`,
        order: index,
        sectionId: section.section_id,
        startSec: round(section.start_sec),
        endSec: round(section.end_sec),
        durationSec: round(section.end_sec - section.start_sec),
        frameIntent: "Use the locked MP4 as full-bleed muted background video and animate teaching knowledge cards above it.",
        headline,
        bodyLines: lyricLines.slice(index * 2 + 1, index * 2 + 3),
        captionMode: "keyword_burst",
        visualDirectives: [
          "full-frame MP4 background video",
          "knowledge card overlay",
          "teaching callouts",
          "keyword pop synced to beat and lyrics",
          "keep cards readable and do not cover the full background",
        ],
        beatSync: { intensity: 0.75 },
        assets: [{
          id: "locked_background_video",
          type: "video",
          path: input.sourceImport.source_video.path,
          role: "background_video",
        }],
      };
    }),
  };
}

async function writeVideoChainAgentContext(paths: SmallProjectPaths, plan: AnimationPlan, sourceImport: SourceVideoImportFile): Promise<void> {
  const context = buildAgentContext({ plan, paths, sourceVideoImport: sourceImport });
  context.sourceFiles.animationPlan = "../../../data/chains/video_chain/video_animation_plan.json";
  context.sourceFiles.sectionMap = "../../../data/timing/section_map.json";
  context.sourceFiles.beatGrid = "../../../data/timing/beat_grid.json";
  context.sourceFiles.lyricWordTiming = "../../../data/timing/lyric_word_timing.json";
  context.sourceFiles.masterAudio = "../../../active_music_take.mp3";
  context.sourceVideo = {
    enabled: true,
    status: "locked",
    path: sourceImport.source_video.path,
    sha256: sourceImport.source_video.sha256,
    audioPolicy: "background_video_only",
  };
  await writeJson(paths.codexAgentContextPath, context);
}

async function stageBackgroundVideoForFrames(paths: SmallProjectPaths, sourceImport: SourceVideoImportFile): Promise<void> {
  const relativePath = safeFrameAssetRelativePath(sourceImport.source_video.path);
  await mkdir(path.dirname(path.join(paths.framesDir, relativePath)), { recursive: true });
  await copyFile(path.join(paths.projectRoot, sourceImport.source_video.path), path.join(paths.framesDir, relativePath));
}

async function runAgentRuntime(paths: SmallProjectPaths, deps: VideoChainDeps): Promise<HtmlVideoAgentRuntimeResult> {
  try {
    return await (deps.runHtmlVideoAgentRuntime ?? runHtmlVideoAgentRuntimeDefault)({
      projectDir: paths.htmlVideoProjectDir,
      promptPath: paths.codexPromptPath,
      agentId: "codex",
      model: process.env.QIVANCE_HTML_VIDEO_MODEL,
      timeoutMs: Number(process.env.QIVANCE_HTML_VIDEO_RUNTIME_TIMEOUT_MS ?? 2 * 60 * 1000),
    });
  } catch (error) {
    return {
      agentId: "codex",
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

async function syncProjectFramesFromContracts(paths: SmallProjectPaths, contracts: QivanceFrameContracts): Promise<void> {
  const store = new ProjectStore(paths.htmlVideoRoot);
  const project = await store.load(paths.smallProjectId);
  const frames = Object.values(contracts.frames)
    .sort((a, b) => a.order - b.order)
    .map((contract) => ({
      graphNodeId: contract.graphNodeId,
      htmlPath: `${paths.htmlVideoProjectDir}/${contract.allowedHtmlPath}`,
      durationSec: contract.durationSec,
      order: contract.order,
    }));
  const nextProject: Project = {
    ...project,
    frames,
    lastPreviewHtmlPath: frames[0]?.htmlPath,
    status: "previewed",
    updatedAt: new Date().toISOString(),
  };
  await store.save(nextProject);
}

async function copyChainFrameContracts(projectRoot: string, frameContracts: QivanceFrameContracts): Promise<void> {
  await writeJson(path.join(projectRoot, "data/chains/video_chain/frame_contracts.json"), frameContracts);
}

function projectPaths(project: DbProject): SmallProjectPaths {
  return resolveSmallProjectPaths(path.dirname(project.projectRoot), project.id);
}

function withMp3MasterAudio(contracts: QivanceFrameContracts): QivanceFrameContracts {
  return { ...contracts, masterAudioPath: "active_music_take.mp3" };
}

function forbiddenPathChanges(changedFiles: string[]): string[] {
  try {
    assertAllowedPathChanges(changedFiles);
    return [];
  } catch (error) {
    if (error instanceof CodexForbiddenFileChangeError) return error.changedFiles;
    throw error;
  }
}

function runtimeDiagnostics(runtime: HtmlVideoAgentRuntimeResult): string[] {
  const diagnostics: string[] = [];
  if (runtime.stderr.trim()) diagnostics.push(`stderr: ${truncateDiagnosticOutput(runtime.stderr)}`);
  if (runtime.stdout.trim()) diagnostics.push(`stdout: ${truncateDiagnosticOutput(runtime.stdout)}`);
  return diagnostics;
}

function truncateDiagnosticOutput(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 2000 ? `${trimmed.slice(0, 2000)}...` : trimmed;
}

async function evidenceRef(projectRoot: string, relativePath: string): Promise<{ path: string; sha256: string }> {
  return {
    path: relativePath,
    sha256: await sha256File(path.join(projectRoot, relativePath)),
  };
}

async function readProjectJson<T>(projectRoot: string, relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(projectRoot, relativePath), "utf8")) as T;
}

async function readOptionalProjectJson<T>(projectRoot: string, relativePath: string): Promise<T | null> {
  try {
    return await readProjectJson<T>(projectRoot, relativePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function ffprobeJson(filePath: string, deps: VideoChainDeps): Promise<Record<string, unknown>> {
  if (deps.ffprobeJson) return deps.ffprobeJson(filePath);
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath], { maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(stdout) as Record<string, unknown>;
}

function streamCount(probe: Record<string, unknown>, codecType: string): number {
  return probeStreams(probe).filter((stream) => stream.codec_type === codecType).length;
}

function probeDurationSec(probe: Record<string, unknown>): number {
  const format = isRecord(probe.format) ? probe.format : {};
  const duration = Number(format.duration);
  if (Number.isFinite(duration)) return duration;
  const streamDuration = probeStreams(probe).map((stream) => Number(stream.duration)).find((value) => Number.isFinite(value));
  if (streamDuration !== undefined) return streamDuration;
  throw new Error("ffprobe duration is missing.");
}

function probeStreams(probe: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(probe.streams) ? probe.streams.filter(isRecord) : [];
}

function extractLyricLines(lyricsText: string): string[] {
  return lyricsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^#+\s*/.test(line));
}

function aspectRatio(width: number, height: number): "16:9" | "9:16" | "1:1" {
  if (Math.abs(width - height) <= 4) return "1:1";
  return width > height ? "16:9" : "9:16";
}

function safeFrameAssetRelativePath(value: string): string {
  if (path.isAbsolute(value) || value.split(/[\\/]+/).includes("..")) {
    throw new Error("Source video path must be project-relative for frame staging.");
  }
  return path.normalize(value).replaceAll(path.sep, "/");
}

function videoSources(html: string): string[] {
  return [
    ...Array.from(html.matchAll(/<video[^>]+src=["']([^"']+)["']/gi), (match) => match[1] ?? ""),
    ...Array.from(html.matchAll(/<source[^>]+src=["']([^"']+)["']/gi), (match) => match[1] ?? ""),
  ].filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
