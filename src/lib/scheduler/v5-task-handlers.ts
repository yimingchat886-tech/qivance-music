import { execFile as execFileCallback } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { validateAudioAnalysisArtifacts } from "../audio-analysis/librosa-runner.ts";
import type { BeatGrid, EnergyCurve, OnsetEvents } from "../audio-analysis/types.ts";
import { buildChatAnimationPlan, validateChatAnimationPlan, writeChatAnimationPlan } from "../chat-dialogue/chat-animation-plan.ts";
import { renderChatRuntimeToVisual } from "../chat-dialogue/chat-browser-recorder.ts";
import { buildChatFrameContracts, validateChatFrameContracts, writeChatFrameContracts } from "../chat-dialogue/chat-frame-contracts.ts";
import { renderChatFrameHtml, validateChatFrameHtml, writeChatFrameHtml } from "../chat-dialogue/chat-frame-html.ts";
import { renderChatFramesToVisual } from "../chat-dialogue/chat-frame-renderer.ts";
import { renderChatRuntimeHtml, validateChatRuntimeHtml, writeChatRuntimeHtml } from "../chat-dialogue/chat-runtime-html.ts";
import { buildChatRuntimeTimeline, validateChatRuntimeTimeline, writeChatRuntimeTimeline, type ChatRuntimeTimeline } from "../chat-dialogue/chat-runtime-timeline.ts";
import type { ChatFrameContracts } from "../chat-dialogue/chat-frame-contracts.ts";
import { buildConversationPlan, validateConversationPlan, withProjectChatAvatarUi, writeConversationPlan, type ConversationPlan } from "../chat-dialogue/conversation-plan.ts";
import type { LyricWordTiming, SectionMapLike } from "../chat-dialogue/line-timing.ts";
import { buildLyricsLineMap, validateLyricsLineMap, writeLyricsLineMap, type LyricsLineMap } from "../chat-dialogue/lyrics-line-map.ts";
import { buildSpeakerAttribution, validateSpeakerAttribution, writeSpeakerAttribution, type SpeakerAttribution } from "../chat-dialogue/speaker-attribution.ts";
import { muxLockedAudio as muxLockedAudioDefault } from "../export/mux-locked-audio.ts";
import { buildRenderManifestV4, validateRenderManifestV4, type RenderManifestV4EvidenceRef } from "../export/render-manifest-v4.ts";
import { sha256File, writeJson } from "../fs-utils.ts";
import { resolveMediaE2EPythonEnv } from "../media-e2e/python-env.ts";
import { parseLockedInputSnapshot } from "../project-core/locked-input-snapshot.ts";
import { buildSectionMapFromEvidence } from "../section-map/section-map-builder.ts";
import {
  buildVideoChainFrames,
  muxVideoChainFinal,
  prepareVideoChainContext,
  renderVideoChainVisual,
  writeVideoChainManifest,
  writeVideoChainQaReport,
  type VideoChainDeps,
} from "../video-chain/video-chain-runner.ts";
import { runWhisperXAlignment as runWhisperXAlignmentDefault } from "../word-alignment/whisperx-runner.ts";
import type { V5SchedulerTaskHandlerInput, V5SchedulerTaskHandlers } from "./server-runner-loop.ts";

const execFileAsync = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export type V5TaskHandlerDeps = VideoChainDeps & {
  runAudioAnalysis?: (input: {
    pythonExecutable: string;
    scriptPath: string;
    audioPath: string;
    outputDir: string;
  }) => Promise<void>;
  runWhisperXAlignment?: typeof runWhisperXAlignmentDefault;
  renderChatFramesToVisual?: typeof renderChatFramesToVisual;
  renderChatRuntimeToVisual?: typeof renderChatRuntimeToVisual;
  muxLockedAudio?: typeof muxLockedAudioDefault;
  ffprobeJson?: (filePath: string) => Promise<Record<string, unknown>>;
};

export function createV5TaskHandlers(deps: V5TaskHandlerDeps = {}): Partial<V5SchedulerTaskHandlers> {
  return {
    run_timing_pipeline: (input) => runTimingPipelineTask(input, deps),
    build_lyrics_line_map: buildLyricsLineMapTask,
    build_speaker_attribution: buildSpeakerAttributionTask,
    build_conversation_plan: buildConversationPlanTask,
    build_chat_frames: buildChatFramesTask,
    render_visual: (input) => renderVisualTask(input, deps),
    mux_final: (input) => muxFinalTask(input, deps),
    qa_report: (input) => writeQaReportTask(input, deps),
    write_manifest: (input) => writeManifestTask(input, deps),
    prepare_video_context: (input) => prepareVideoContextTask(input, deps),
    build_video_frames: (input) => buildVideoFramesTask(input, deps),
    render_video_visual: (input) => renderVideoVisualTask(input, deps),
    mux_video_final: (input) => muxVideoFinalTask(input, deps),
    video_qa_report: (input) => writeVideoQaReportTask(input, deps),
    write_video_manifest: (input) => writeVideoManifestTask(input, deps),
  };
}

async function runTimingPipelineTask({ prisma, task }: V5SchedulerTaskHandlerInput, deps: V5TaskHandlerDeps): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
  const audioPath = path.join(project.projectRoot, "active_music_take.mp3");
  const lyricsPath = path.join(project.projectRoot, "lyrics.md");
  const timingDir = path.join(project.projectRoot, "data/timing");
  const durationSec = await ffprobeDurationSec(audioPath, deps).catch((error) => {
    throw timingError("ffprobe could not read active_music_take.mp3", error, "timing_failed");
  });
  await mkdir(timingDir, { recursive: true });
  const pythonEnv = resolveMediaE2EPythonEnv({ cwd: repoRoot });
  await runAudioAnalysis({
    deps,
    pythonExecutable: pythonEnv.pythonExecutable,
    scriptPath: path.join(repoRoot, "scripts/python/analyze-audio-librosa.py"),
    audioPath,
    outputDir: timingDir,
  });
  const beatGrid = await readProjectJson<BeatGrid>(project.projectRoot, "data/timing/beat_grid.json");
  const onsetEvents = await readProjectJson<OnsetEvents>(project.projectRoot, "data/timing/onset_events.json");
  const energyCurve = await readProjectJson<EnergyCurve>(project.projectRoot, "data/timing/energy_curve.json");
  const validation = validateAudioAnalysisArtifacts({
    expectedDurationSec: durationSec,
    beatGrid,
    onsetEvents,
    energyCurve,
  });
  if (!validation.ok) throw new Error(`timing_failed: ${validation.issues.join("; ")}`);

  const runWhisperXAlignment = deps.runWhisperXAlignment ?? runWhisperXAlignmentDefault;
  await runWhisperXAlignment({
    pythonExecutable: pythonEnv.pythonExecutable,
    scriptPath: path.join(repoRoot, "scripts/python/align-lyrics-whisperx.py"),
    audioPath,
    lyricsPath,
    wordTimingPath: path.join(timingDir, "lyric_word_timing.json"),
    reportPath: path.join(timingDir, "alignment_report.json"),
    language: process.env.QIVANCE_WHISPERX_LANGUAGE ?? "zh",
    device: pythonEnv.whisperx.device,
    model: pythonEnv.whisperx.model,
    cacheDir: pythonEnv.whisperx.cacheDir,
    requireGpu: pythonEnv.whisperx.requireGpu,
    timeoutMs: Number(process.env.QIVANCE_WHISPERX_TIMEOUT_MS ?? 10 * 60 * 1000),
  }).catch((error) => {
    throw timingError("WhisperX alignment could not produce lyric_word_timing.json", error, "timing_failed");
  });

  const lyricsText = await readFile(lyricsPath, "utf8");
  const lineMap = buildLyricsLineMap({
    lyricsText,
    lyricsPath: "lyrics.md",
    lyricsSha256: await sha256File(lyricsPath),
  });
  const lyricWordTiming = await readProjectJson<LyricWordTiming>(project.projectRoot, "data/timing/lyric_word_timing.json");
  const alignmentReport = await readProjectJson<{ status?: string; metrics?: Record<string, unknown> }>(project.projectRoot, "data/timing/alignment_report.json");
  if (alignmentReport.status !== "passed" || lyricWordTiming.words.length === 0) {
    throw new Error("timing_failed: WhisperX alignment did not pass or produced no words.");
  }
  const sectionMap = buildSectionMapFromEvidence({
    durationSec,
    scenes: [{ scene_id: "sec_001", section_ids: ["sec_001"], start_sec: 0, end_sec: durationSec }],
    words: lyricWordTiming.words.map((word, index) => ({
      word_id: stringField(word, "word_id") ?? `w_${String(index + 1).padStart(6, "0")}`,
      paragraph_id: stringField(word, "paragraph_id") ?? "p_001",
      start_sec: word.start_sec,
      end_sec: word.end_sec,
    })),
    beats: beatGrid.beats,
  });
  await writeJson(path.join(timingDir, "section_map.json"), sectionMap);
}

async function buildLyricsLineMapTask({ prisma, task }: V5SchedulerTaskHandlerInput): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
  const result = await writeLyricsLineMap({ projectRoot: project.projectRoot });
  assertValidation("lyrics_line_map_invalid", validateLyricsLineMap(result.lineMap));
}

async function buildSpeakerAttributionTask({ prisma, task }: V5SchedulerTaskHandlerInput): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
  const lineMap = await readProjectJson<LyricsLineMap>(project.projectRoot, "data/chains/chat_dialogue_mv/lyrics_line_map.json");
  const result = await writeSpeakerAttribution({
    projectRoot: project.projectRoot,
    lineMap,
    lineMapSha256: lineMap.source.lyrics_sha256,
  });
  assertValidation("speaker_attribution_invalid", validateSpeakerAttribution({ lineMap, speakerAttribution: result.speakerAttribution }));
}

async function buildConversationPlanTask({ prisma, task }: V5SchedulerTaskHandlerInput): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
  const lineMap = await readProjectJson<LyricsLineMap>(project.projectRoot, "data/chains/chat_dialogue_mv/lyrics_line_map.json");
  const speakerAttribution = await readProjectJson<SpeakerAttribution>(project.projectRoot, "data/chains/chat_dialogue_mv/speaker_attribution.json");
  const lyricWordTiming = await readProjectJson<LyricWordTiming>(project.projectRoot, "data/timing/lyric_word_timing.json");
  const sectionMap = await readProjectJson<SectionMapLike>(project.projectRoot, "data/timing/section_map.json");
  const result = buildConversationPlan({
    lineMap,
    speakerAttribution,
    lyricWordTiming,
    sectionMap,
    lyricsPath: "lyrics.md",
    audioPath: "active_music_take.mp3",
    lyricsSha256: lineMap.source.lyrics_sha256,
    audioSha256: await sha256File(path.join(project.projectRoot, "active_music_take.mp3")),
    allowDiagnosticFallback: false,
  });
  if (!result.conversationPlan) throw new Error(`conversation_plan_invalid: ${result.issues.join("; ")}`);
  const conversationPlan = await withProjectChatAvatarUi({ projectRoot: project.projectRoot, conversationPlan: result.conversationPlan });
  assertValidation("conversation_plan_invalid", validateConversationPlan({ conversationPlan, lineMap, speakerAttribution }));
  await writeConversationPlan({ projectRoot: project.projectRoot, conversationPlan });
}

async function buildChatFramesTask({ prisma, task }: V5SchedulerTaskHandlerInput): Promise<{ outputArtifacts: Array<{ path: string; kind?: string }> }> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
  const conversationPlan = await readProjectJson<ConversationPlan>(project.projectRoot, "data/chains/chat_dialogue_mv/conversation_plan.json");
  const sectionMap = await readProjectJson<SectionMapLike>(project.projectRoot, "data/timing/section_map.json");
  const animationPlan = buildChatAnimationPlan({ conversationPlan, durationSec: sectionMap.duration_sec ?? conversationPlan.messages.at(-1)?.end_sec ?? 1 });
  assertValidation("chat_animation_plan_invalid", validateChatAnimationPlan({ conversationPlan, animationPlan }));
  await writeChatAnimationPlan({ projectRoot: project.projectRoot, animationPlan });
  const runtimeTimeline = buildChatRuntimeTimeline({ conversationPlan, animationPlan, fps: 60 });
  assertValidation("chat_runtime_timeline_invalid", validateChatRuntimeTimeline({ conversationPlan, runtimeTimeline }));
  await writeChatRuntimeTimeline({ projectRoot: project.projectRoot, runtimeTimeline });
  const runtimeHtml = renderChatRuntimeHtml({ conversationPlan, animationPlan, runtimeTimeline });
  assertValidation("chat_runtime_html_invalid", validateChatRuntimeHtml(runtimeHtml));
  const runtimeHtmlPath = (await writeChatRuntimeHtml({ projectRoot: project.projectRoot, projectId: project.id, html: runtimeHtml })).path;
  if (process.env.QIVANCE_CHAT_STATIC_FALLBACK === "1") {
    const frameContracts = buildChatFrameContracts({ projectId: project.id, conversationPlan, animationPlan });
    assertValidation("chat_frame_contracts_invalid", validateChatFrameContracts({ conversationPlan, frameContracts }));
    await writeChatFrameContracts({ projectRoot: project.projectRoot, frameContracts });
    for (const frame of frameContracts.frames) {
      const html = renderChatFrameHtml({ frame, conversationPlan });
      assertValidation("chat_frame_html_invalid", validateChatFrameHtml(html));
      await writeChatFrameHtml({ htmlPath: path.join(project.projectRoot, frame.html_path), frame, conversationPlan });
    }
  }
  return {
    outputArtifacts: [
      { path: runtimeHtmlPath, kind: "runtime_html" },
    ],
  };
}

async function renderVisualTask({ prisma, task }: V5SchedulerTaskHandlerInput, deps: V5TaskHandlerDeps): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
  const runtimeTimelinePath = "data/chains/chat_dialogue_mv/runtime_timeline.json";
  if (await fileExists(path.join(project.projectRoot, runtimeTimelinePath))) {
    const runtimeTimeline = await readProjectJson<ChatRuntimeTimeline>(project.projectRoot, runtimeTimelinePath);
    if (runtimeTimeline.render_mode === "browser_recording") {
      await (deps.renderChatRuntimeToVisual ?? renderChatRuntimeToVisual)({
        projectRoot: project.projectRoot,
        runtimeHtmlPath: `video/html-video/.html-video/projects/${project.id}/runtime/chat_dialogue_mv.html`,
        runtimeTimeline,
        outputPath: path.join(project.projectRoot, "exports/chat_dialogue_mv/visual.mp4"),
      });
      return;
    }
  }
  if (process.env.QIVANCE_CHAT_STATIC_FALLBACK !== "1") throw new Error("chat_runtime_timeline_missing: build runtime_timeline.json before render_visual.");
  const frameContracts = await readProjectJson<ChatFrameContracts>(project.projectRoot, "data/chains/chat_dialogue_mv/frame_contracts.json");
  await (deps.renderChatFramesToVisual ?? renderChatFramesToVisual)({
    projectRoot: project.projectRoot,
    frameContracts,
    outputPath: path.join(project.projectRoot, "exports/chat_dialogue_mv/visual.mp4"),
  });
}

async function muxFinalTask({ prisma, task }: V5SchedulerTaskHandlerInput, deps: V5TaskHandlerDeps): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
  await (deps.muxLockedAudio ?? muxLockedAudioDefault)({
    visualMp4Path: path.join(project.projectRoot, "exports/chat_dialogue_mv/visual.mp4"),
    masterAudioPath: path.join(project.projectRoot, "active_music_take.mp3"),
    finalMp4Path: path.join(project.projectRoot, "exports/chat_dialogue_mv/final.mp4"),
  });
}

async function writeQaReportTask({ prisma, task }: V5SchedulerTaskHandlerInput, deps: V5TaskHandlerDeps): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
  const finalProbe = await ffprobeJson(path.join(project.projectRoot, "exports/chat_dialogue_mv/final.mp4"), deps);
  const audioProbe = await ffprobeJson(path.join(project.projectRoot, "active_music_take.mp3"), deps);
  const audioStreamCount = streamCount(finalProbe, "audio");
  const durationDriftMs = Math.round(Math.abs(probeDurationSec(finalProbe) - probeDurationSec(audioProbe)) * 1000);
  if (audioStreamCount !== 1) throw new Error(`chat_export_audio_stream_invalid: final.mp4 must have exactly one audio stream, got ${audioStreamCount}.`);
  if (durationDriftMs > 150) throw new Error(`chat_export_duration_drift: final.mp4 duration drift ${durationDriftMs}ms exceeds 150ms.`);
  await writeJson(path.join(project.projectRoot, "data/chains/chat_dialogue_mv/qa_report.json"), {
    schema_version: 1,
    chain_id: "chat_dialogue_mv",
    status: "passed",
    audio_stream_count: audioStreamCount,
    duration_drift_ms: durationDriftMs,
    ffprobe: finalProbe,
  });
}

async function writeManifestTask({ prisma, run, task }: V5SchedulerTaskHandlerInput, deps: V5TaskHandlerDeps): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
  await assertLockedInputSha(project.projectRoot, run.lockedInputsJson);
  const finalProbe = await ffprobeJson(path.join(project.projectRoot, "exports/chat_dialogue_mv/final.mp4"), deps);
  const audioProbe = await ffprobeJson(path.join(project.projectRoot, "active_music_take.mp3"), deps);
  const audioStreamCount = streamCount(finalProbe, "audio");
  const durationDriftMs = Math.round(Math.abs(probeDurationSec(finalProbe) - probeDurationSec(audioProbe)) * 1000);
  const frameContractsEvidence = await optionalEvidenceRef(project.projectRoot, "data/chains/chat_dialogue_mv/frame_contracts.json");
  const manifest = buildRenderManifestV4({
    mode: "production",
    runId: run.id,
    conversationPlan: await evidenceRef(project.projectRoot, "data/chains/chat_dialogue_mv/conversation_plan.json"),
    ...(frameContractsEvidence ? { frameContracts: frameContractsEvidence } : {}),
    runtimeTimeline: await evidenceRef(project.projectRoot, "data/chains/chat_dialogue_mv/runtime_timeline.json"),
    runtimeHtml: await evidenceRef(project.projectRoot, `video/html-video/.html-video/projects/${project.id}/runtime/chat_dialogue_mv.html`),
    browserRenderEvidence: await evidenceRef(project.projectRoot, "data/chains/chat_dialogue_mv/browser_render_evidence.json"),
    renderMode: "browser_recording",
    fps: 60,
    lyrics: await evidenceRef(project.projectRoot, "lyrics.md"),
    audio: await evidenceRef(project.projectRoot, "active_music_take.mp3"),
    timing: {
      beat_grid: await evidenceRef(project.projectRoot, "data/timing/beat_grid.json"),
      onset_events: await evidenceRef(project.projectRoot, "data/timing/onset_events.json"),
      energy_curve: await evidenceRef(project.projectRoot, "data/timing/energy_curve.json"),
      lyric_word_timing: await evidenceRef(project.projectRoot, "data/timing/lyric_word_timing.json"),
      alignment_report: await evidenceRef(project.projectRoot, "data/timing/alignment_report.json"),
      section_map: await evidenceRef(project.projectRoot, "data/timing/section_map.json"),
    },
    visual: await evidenceRef(project.projectRoot, "exports/chat_dialogue_mv/visual.mp4"),
    final: await evidenceRef(project.projectRoot, "exports/chat_dialogue_mv/final.mp4"),
    ffprobe: finalProbe,
    durationDriftMs,
    audioStreamCount,
    fallbackFramesUsed: false,
    diagnosticOnly: false,
    remoteResourcesUsed: false,
  });
  assertValidation("render_manifest_v4_invalid", validateRenderManifestV4(manifest));
  await writeJson(path.join(project.projectRoot, "exports/chat_dialogue_mv/render_manifest.json"), manifest);
  await prisma.chain.updateMany({
    where: { projectId: project.id, chainId: "chat_dialogue_mv" },
    data: { status: "passed" },
  });
  await prisma.project.update({
    where: { id: project.id },
    data: { status: "passed" },
  });
}

async function prepareVideoContextTask({ prisma, task }: V5SchedulerTaskHandlerInput, deps: V5TaskHandlerDeps): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
  await prepareVideoChainContext(project, deps);
}

async function buildVideoFramesTask({ prisma, task }: V5SchedulerTaskHandlerInput, deps: V5TaskHandlerDeps): ReturnType<typeof buildVideoChainFrames> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
  return buildVideoChainFrames(project, deps);
}

async function renderVideoVisualTask({ prisma, task }: V5SchedulerTaskHandlerInput, deps: V5TaskHandlerDeps): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
  await renderVideoChainVisual(project, deps);
}

async function muxVideoFinalTask({ prisma, task }: V5SchedulerTaskHandlerInput, deps: V5TaskHandlerDeps): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
  await muxVideoChainFinal(project, deps);
}

async function writeVideoQaReportTask({ prisma, task }: V5SchedulerTaskHandlerInput, deps: V5TaskHandlerDeps): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
  await writeVideoChainQaReport(project, deps);
}

async function writeVideoManifestTask({ prisma, run, task }: V5SchedulerTaskHandlerInput, deps: V5TaskHandlerDeps): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
  await assertLockedInputSha(project.projectRoot, run.lockedInputsJson);
  await writeVideoChainManifest(project, run.id, deps);
  await prisma.chain.updateMany({
    where: { projectId: project.id, chainId: "video_chain" },
    data: { status: "passed" },
  });
  await prisma.project.update({
    where: { id: project.id },
    data: { status: "passed" },
  });
}

async function assertLockedInputSha(projectRoot: string, lockedInputsJson: string | null): Promise<void> {
  const lockedInputs = parseLockedInputSnapshot(lockedInputsJson);
  for (const input of lockedInputs.inputs) {
    const stableSha = await sha256File(path.join(projectRoot, input.stable_path));
    if (stableSha !== input.sha256) {
      throw new Error(`artifact_inconsistent: locked ${input.kind} sha does not match locked input ${input.id}`);
    }
  }
}

async function readProjectJson<T>(projectRoot: string, relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(projectRoot, relativePath), "utf8")) as T;
}

async function evidenceRef(projectRoot: string, relativePath: string): Promise<RenderManifestV4EvidenceRef> {
  return {
    path: relativePath,
    sha256: await sha256File(path.join(projectRoot, relativePath)),
  };
}

async function optionalEvidenceRef(projectRoot: string, relativePath: string): Promise<RenderManifestV4EvidenceRef | undefined> {
  return await fileExists(path.join(projectRoot, relativePath)) ? evidenceRef(projectRoot, relativePath) : undefined;
}

async function fileExists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true, () => false);
}

async function runAudioAnalysis(input: {
  deps: V5TaskHandlerDeps;
  pythonExecutable: string;
  scriptPath: string;
  audioPath: string;
  outputDir: string;
}): Promise<void> {
  try {
    if (input.deps.runAudioAnalysis) {
      await input.deps.runAudioAnalysis(input);
      return;
    }
    await execFileAsync(input.pythonExecutable, [input.scriptPath, input.audioPath, input.outputDir], { maxBuffer: 20 * 1024 * 1024 });
  } catch (error) {
    throw timingError("audio analysis could not produce beat/onset/energy artifacts", error, "timing_failed");
  }
}

async function ffprobeDurationSec(filePath: string, deps: V5TaskHandlerDeps): Promise<number> {
  return probeDurationSec(await ffprobeJson(filePath, deps));
}

async function ffprobeJson(filePath: string, deps: V5TaskHandlerDeps): Promise<Record<string, unknown>> {
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

function assertValidation(code: string, result: { ok: boolean; issues: string[] }): void {
  if (!result.ok) throw new Error(`${code}: ${result.issues.join("; ")}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, field: string): string | null {
  if (!isRecord(value)) return null;
  return typeof value[field] === "string" ? value[field] : null;
}

function timingError(context: string, error: unknown, defaultCode: "timing_blocked" | "timing_failed"): Error {
  const message = error instanceof Error ? error.message : String(error);
  const code = isDependencyFailure(message, error) ? "timing_blocked" : defaultCode;
  return new Error(`${code}: ${context}: ${message}`);
}

function isDependencyFailure(message: string, error: unknown): boolean {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
  return /No module named|ModuleNotFoundError|command not found|not found|cuda|gpu|torch\.cuda|--require-gpu|librosa|whisperx|urlopen|name resolution|network|download/i.test(message);
}
