import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { writeJson, sha256File } from "../src/lib/fs-utils.ts";
import { buildChatAnimationPlan, validateChatAnimationPlan, writeChatAnimationPlan } from "../src/lib/chat-dialogue/chat-animation-plan.ts";
import { buildChatFrameContracts, validateChatFrameContracts, writeChatFrameContracts } from "../src/lib/chat-dialogue/chat-frame-contracts.ts";
import { renderChatFrameHtml, validateChatFrameHtml, writeChatFrameHtml } from "../src/lib/chat-dialogue/chat-frame-html.ts";
import { renderChatFramesToVisual } from "../src/lib/chat-dialogue/chat-frame-renderer.ts";
import { buildConversationPlan, validateConversationPlan, writeConversationPlan } from "../src/lib/chat-dialogue/conversation-plan.ts";
import { writeLyricsLineMap, validateLyricsLineMap, type LyricsLineMap } from "../src/lib/chat-dialogue/lyrics-line-map.ts";
import { writeSpeakerAttribution, validateSpeakerAttribution } from "../src/lib/chat-dialogue/speaker-attribution.ts";
import type { LyricWordTiming, SectionMapLike } from "../src/lib/chat-dialogue/line-timing.ts";
import { buildRenderManifestV4, validateRenderManifestV4, type RenderManifestV4EvidenceRef } from "../src/lib/export/render-manifest-v4.ts";
import { createSchedulerRun } from "../src/lib/scheduler/run-queue.ts";

const execFileAsync = promisify(execFile);
const production = process.argv.includes("--production");
const storageRoot = path.resolve(argValue("--storage-root") ?? path.join("projects", `v4_chat_dialogue_${stamp()}`));
const projectId = argValue("--project-id") ?? "chat_dialogue_v4_fixture";
const projectRoot = path.join(storageRoot, projectId);
const runId = `run_chat_dialogue_v4_${stamp()}`;

if (!production) {
  console.error("usage: node --experimental-strip-types scripts/e2e-chat-dialogue-v4.ts --production [--storage-root <path>] [--project-id <id>]");
  process.exit(2);
}

await mkdir(projectRoot, { recursive: true });
await writeFixtureInputs(projectRoot);
const { path: lineMapPath, lineMap } = await writeLyricsLineMap({ projectRoot });
assertOk("lyrics_line_map", validateLyricsLineMap(lineMap));
await writeTimingBundle(projectRoot, lineMap);

const scheduler = await createSchedulerRun({
  storageRoot,
  runId,
  request: {
    project_ids: [projectId],
    chains: ["chat_dialogue_mv"],
    mode: "production",
    priority: 80,
    diagnostic_allowed: false,
    resume: true,
  },
});

const { path: speakerAttributionPath, speakerAttribution } = await writeSpeakerAttribution({ projectRoot, lineMap, lineMapSha256: lineMap.source.lyrics_sha256 });
assertOk("speaker_attribution", validateSpeakerAttribution({ lineMap, speakerAttribution }));

const lyricWordTiming = await readJson<LyricWordTiming>(path.join(projectRoot, "data/timing/lyric_word_timing.json"));
const sectionMap = await readJson<SectionMapLike>(path.join(projectRoot, "data/timing/section_map.json"));
const conversation = buildConversationPlan({
  lineMap,
  speakerAttribution,
  lyricWordTiming,
  sectionMap,
  lyricsPath: "lyrics.md",
  audioPath: "active_music_take.mp3",
  lyricsSha256: lineMap.source.lyrics_sha256,
  audioSha256: await sha256File(path.join(projectRoot, "active_music_take.mp3")),
  allowDiagnosticFallback: false,
});
if (!conversation.conversationPlan) throw new Error(`conversation_plan failed: ${conversation.issues.join("; ")}`);
assertOk("conversation_plan", validateConversationPlan({ conversationPlan: conversation.conversationPlan, lineMap, speakerAttribution }));
const conversationPlanPath = "data/chains/chat_dialogue_mv/conversation_plan.json";
await writeConversationPlan({ projectRoot, conversationPlan: conversation.conversationPlan });

const animationPlan = buildChatAnimationPlan({ conversationPlan: conversation.conversationPlan, durationSec: sectionMap.duration_sec });
assertOk("chat_animation_plan", validateChatAnimationPlan({ conversationPlan: conversation.conversationPlan, animationPlan }));
const animationPlanPath = (await writeChatAnimationPlan({ projectRoot, animationPlan })).path;

const frameContracts = buildChatFrameContracts({ projectId, conversationPlan: conversation.conversationPlan, animationPlan });
assertOk("chat_frame_contracts", validateChatFrameContracts({ conversationPlan: conversation.conversationPlan, frameContracts }));
const frameContractsPath = (await writeChatFrameContracts({ projectRoot, frameContracts })).path;
for (const frame of frameContracts.frames) {
  const html = renderChatFrameHtml({ frame, conversationPlan: conversation.conversationPlan });
  assertOk(`${frame.frame_id}_html`, validateChatFrameHtml(html));
  await writeChatFrameHtml({ htmlPath: path.join(projectRoot, frame.html_path), frame, conversationPlan: conversation.conversationPlan });
}

const visualPath = "exports/chat_dialogue_mv/visual.mp4";
const finalPath = "exports/chat_dialogue_mv/final.mp4";
await mkdir(path.join(projectRoot, "exports/chat_dialogue_mv"), { recursive: true });
const renderEvidence = await renderChatFramesToVisual({
  projectRoot,
  frameContracts,
  outputPath: path.join(projectRoot, visualPath),
});
await muxAudio({
  visualPath: path.join(projectRoot, visualPath),
  audioPath: path.join(projectRoot, "active_music_take.mp3"),
  finalPath: path.join(projectRoot, finalPath),
});

const finalProbe = await ffprobe(path.join(projectRoot, finalPath));
const audioProbe = await ffprobe(path.join(projectRoot, "active_music_take.mp3"));
const audioStreamCount = streamCount(finalProbe, "audio");
const durationDriftMs = Math.round(Math.abs(durationSec(finalProbe) - durationSec(audioProbe)) * 1000);
if (audioStreamCount !== 1) throw new Error(`final.mp4 must have one audio stream, got ${audioStreamCount}`);
if (durationDriftMs > 150) throw new Error(`duration drift ${durationDriftMs}ms exceeds 150ms`);

const qaReportPath = "data/chains/chat_dialogue_mv/qa_report.json";
await writeJson(path.join(projectRoot, qaReportPath), {
  schema_version: 1,
  chain_id: "chat_dialogue_mv",
  status: "passed",
  audio_stream_count: audioStreamCount,
  duration_drift_ms: durationDriftMs,
  ffprobe: finalProbe,
  frame_renders: renderEvidence.frame_renders,
});

const manifest = buildRenderManifestV4({
  mode: "production",
  runId: scheduler.run.run_id,
  conversationPlan: await evidence(projectRoot, conversationPlanPath),
  frameContracts: await evidence(projectRoot, frameContractsPath),
  lyrics: await evidence(projectRoot, "lyrics.md"),
  audio: await evidence(projectRoot, "active_music_take.mp3"),
  timing: {
    beat_grid: await evidence(projectRoot, "data/timing/beat_grid.json"),
    onset_events: await evidence(projectRoot, "data/timing/onset_events.json"),
    energy_curve: await evidence(projectRoot, "data/timing/energy_curve.json"),
    lyric_word_timing: await evidence(projectRoot, "data/timing/lyric_word_timing.json"),
    alignment_report: await evidence(projectRoot, "data/timing/alignment_report.json"),
    section_map: await evidence(projectRoot, "data/timing/section_map.json"),
  },
  visual: await evidence(projectRoot, visualPath),
  final: await evidence(projectRoot, finalPath),
  ffprobe: finalProbe,
  durationDriftMs,
  audioStreamCount,
  fallbackFramesUsed: false,
  diagnosticOnly: false,
  remoteResourcesUsed: false,
});
const manifestValidation = validateRenderManifestV4(manifest);
assertOk("render_manifest_v4", manifestValidation);
const renderManifestPath = "exports/chat_dialogue_mv/render_manifest.json";
await writeJson(path.join(projectRoot, renderManifestPath), manifest);

await writeJson(path.join(projectRoot, "data/chains/chat_dialogue_mv/chain_status.json"), {
  schema_version: 1,
  chain_id: "chat_dialogue_mv",
  status: "passed",
  mode: "production",
  run_id: scheduler.run.run_id,
  blocking_reasons: [],
  metrics: {
    low_confidence_speaker_count: speakerAttribution.low_confidence_count,
    conversation_message_count: conversation.conversationPlan.messages.length,
    frame_count: frameContracts.frames.length,
    frame_validation_status: "ready",
  },
  artifacts: {
    lyrics_line_map: await fileRef(projectRoot, lineMapPath),
    speaker_attribution: await fileRef(projectRoot, speakerAttributionPath),
    conversation_plan: await fileRef(projectRoot, conversationPlanPath),
    animation_plan: await fileRef(projectRoot, animationPlanPath),
    frame_contracts: await fileRef(projectRoot, frameContractsPath),
    qa_report: await fileRef(projectRoot, qaReportPath),
    render_manifest: await fileRef(projectRoot, renderManifestPath),
    final_mp4: await fileRef(projectRoot, finalPath),
  },
});

console.log(JSON.stringify({
  status: "passed",
  storage_root: storageRoot,
  project_id: projectId,
  run_id: scheduler.run.run_id,
  project_root: projectRoot,
  final_mp4: path.join(projectRoot, finalPath),
  render_manifest: path.join(projectRoot, renderManifestPath),
  qa_report: path.join(projectRoot, qaReportPath),
  rendered_frames: renderEvidence.frame_renders.length,
}, null, 2));

async function writeFixtureInputs(root: string): Promise<void> {
  await writeFile(path.join(root, "lyrics.md"), [
    "Question: who are you",
    "Answer: i am music",
    "Question: why begin now",
    "Answer: because the beat opens",
    "",
  ].join("\n"), "utf8");
  await run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=8",
    "-q:a",
    "4",
    path.join(root, "active_music_take.mp3"),
  ]);
}

async function writeTimingBundle(root: string, lineMap: LyricsLineMap): Promise<void> {
  const sectionMap: SectionMapLike = {
    duration_sec: 8,
    sections: [
      { section_id: "intro_question", start_sec: 0, end_sec: 4 },
      { section_id: "answer_release", start_sec: 4, end_sec: 8 },
    ],
  };
  const words = lineMap.lines.flatMap((line, lineIndex) => {
    const parts = line.display_text.split(/\s+/).filter(Boolean);
    const lineStart = lineIndex * 2;
    return parts.map((word, wordIndex) => ({
      word,
      line_id: line.line_id,
      start_sec: lineStart + wordIndex * 0.3,
      end_sec: lineStart + wordIndex * 0.3 + 0.25,
    }));
  });
  const timing: LyricWordTiming = { schema_version: 1, duration_sec: 8, words };
  await writeJson(path.join(root, "data/timing/beat_grid.json"), { schema_version: 1, bpm: 120, beats: [] });
  await writeJson(path.join(root, "data/timing/onset_events.json"), { schema_version: 1, onsets: [] });
  await writeJson(path.join(root, "data/timing/energy_curve.json"), { schema_version: 1, points: [] });
  await writeJson(path.join(root, "data/timing/lyric_word_timing.json"), timing);
  await writeJson(path.join(root, "data/timing/alignment_report.json"), { schema_version: 1, status: "passed" });
  await writeJson(path.join(root, "data/timing/section_map.json"), sectionMap);
}

async function muxAudio(input: { visualPath: string; audioPath: string; finalPath: string }): Promise<void> {
  await run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input.visualPath,
    "-i",
    input.audioPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    input.finalPath,
  ]);
}

async function ffprobe(filePath: string): Promise<Record<string, unknown>> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath]);
  return JSON.parse(stdout) as Record<string, unknown>;
}

async function run(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(command, args, { maxBuffer: 20 * 1024 * 1024 });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${command} ${args.join(" ")} failed: ${message}`);
  }
}

async function evidence(root: string, relativePath: string): Promise<RenderManifestV4EvidenceRef> {
  return {
    path: relativePath,
    sha256: await sha256File(path.join(root, relativePath)),
  };
}

async function fileRef(root: string, relativePath: string): Promise<{ exists: true; path: string; sha256: string }> {
  return {
    exists: true,
    path: relativePath,
    sha256: await sha256File(path.join(root, relativePath)),
  };
}

function assertOk(label: string, result: { ok: boolean; issues: string[] }): void {
  if (!result.ok) throw new Error(`${label}: ${result.issues.join("; ")}`);
}

function streamCount(probe: Record<string, unknown>, codecType: string): number {
  return streams(probe).filter((stream) => stream.codec_type === codecType).length;
}

function durationSec(probe: Record<string, unknown>): number {
  const format = isRecord(probe.format) ? probe.format : {};
  const duration = Number(format.duration);
  if (Number.isFinite(duration)) return duration;
  const streamDuration = streams(probe).map((stream) => Number(stream.duration)).find((value) => Number.isFinite(value));
  if (streamDuration !== undefined) return streamDuration;
  throw new Error("ffprobe duration missing");
}

function streams(probe: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(probe.streams) ? probe.streams.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function stamp(): string {
  return new Date().toISOString().replaceAll(/[^0-9]+/g, "").slice(0, 14);
}
