import path from "node:path";
import { writeJson } from "../fs-utils.ts";
import type { LineTiming, LyricWordTiming, SectionMapLike } from "./line-timing.ts";
import { buildLineTimings } from "./line-timing.ts";
import type { LyricsLineMap } from "./lyrics-line-map.ts";
import type { SpeakerAttribution } from "./speaker-attribution.ts";

export type ChatConversationUiProfile = {
  contact_name?: string;
  contact_status?: string;
  contact_avatar_src?: string;
  left_avatar_src?: string;
  right_avatar_src?: string;
};

export type ConversationPlan = {
  schema_version: 1;
  chain_id: "chat_dialogue_mv";
  text_policy: "verbatim_lyrics";
  source: {
    lyrics_path: string;
    audio_path: string;
    lyrics_sha256: string;
    audio_sha256: string;
  };
  timing: {
    source: "lyric_word_timing" | "diagnostic_even_split";
    lyric_word_timing_path: string;
    section_map_path: string;
    diagnostic_fallback_used: boolean;
  };
  speakers: SpeakerAttribution["speakers"];
  messages: ConversationMessage[];
  chat_ui?: ChatConversationUiProfile;
};

export type ConversationMessage = {
  id: string;
  source_line_id: string;
  speaker: "questioner" | "answerer";
  side: "left" | "right";
  raw_text: string;
  display_text: string;
  text_policy: "verbatim_lyrics";
  attribution_source: SpeakerAttribution["assignments"][number]["attribution_source"];
  start_sec: number;
  end_sec: number;
  section_id: string;
  confidence: number;
};

export function buildConversationPlan(input: {
  lineMap: LyricsLineMap;
  speakerAttribution: SpeakerAttribution;
  lyricWordTiming?: LyricWordTiming | null;
  sectionMap: SectionMapLike;
  lyricsPath?: string;
  audioPath?: string;
  lyricsSha256?: string;
  audioSha256?: string;
  allowDiagnosticFallback?: boolean;
}): { conversationPlan?: ConversationPlan; issues: string[] } {
  const timingResult = buildLineTimings({
    lineMap: input.lineMap,
    lyricWordTiming: input.lyricWordTiming,
    sectionMap: input.sectionMap,
    allowDiagnosticFallback: input.allowDiagnosticFallback,
  });
  if (timingResult.issues.length > 0) return { issues: timingResult.issues };
  const assignmentByLine = new Map(input.speakerAttribution.assignments.map((assignment) => [assignment.line_id, assignment]));
  const timingByLine = new Map(timingResult.timings.map((timing) => [timing.line_id, timing]));
  const messages: ConversationMessage[] = [];
  for (const line of input.lineMap.lines) {
    const assignment = assignmentByLine.get(line.line_id);
    const timing = timingByLine.get(line.line_id);
    if (!assignment) return { issues: [`missing speaker assignment for ${line.line_id}`] };
    if (!timing) return { issues: [`missing timing for ${line.line_id}`] };
    messages.push(toMessage(messages.length + 1, line, assignment, timing));
  }
  messages.sort((a, b) => a.start_sec - b.start_sec);
  const conversationPlan: ConversationPlan = {
    schema_version: 1,
    chain_id: "chat_dialogue_mv",
    text_policy: "verbatim_lyrics",
    source: {
      lyrics_path: input.lyricsPath ?? input.lineMap.source.lyrics_path,
      audio_path: input.audioPath ?? "active_music_take.mp3",
      lyrics_sha256: input.lyricsSha256 ?? input.lineMap.source.lyrics_sha256,
      audio_sha256: input.audioSha256 ?? "",
    },
    timing: {
      source: timingResult.diagnosticFallbackUsed ? "diagnostic_even_split" : "lyric_word_timing",
      lyric_word_timing_path: "data/timing/lyric_word_timing.json",
      section_map_path: "data/timing/section_map.json",
      diagnostic_fallback_used: timingResult.diagnosticFallbackUsed,
    },
    speakers: input.speakerAttribution.speakers,
    messages,
  };
  const validation = validateConversationPlan({ conversationPlan, lineMap: input.lineMap, speakerAttribution: input.speakerAttribution, lineTimings: timingResult.timings });
  return validation.ok ? { conversationPlan, issues: [] } : { issues: validation.issues };
}

export async function writeConversationPlan(input: {
  projectRoot: string;
  conversationPlan: ConversationPlan;
}): Promise<{ path: string }> {
  const relativePath = "data/chains/chat_dialogue_mv/conversation_plan.json";
  await writeJson(path.join(input.projectRoot, relativePath), input.conversationPlan);
  return { path: relativePath };
}

export async function withProjectChatAvatarUi(input: {
  projectRoot: string;
  conversationPlan: ConversationPlan;
}): Promise<ConversationPlan> {
  return {
    ...input.conversationPlan,
    chat_ui: {
      ...input.conversationPlan.chat_ui,
      contact_avatar_src: "../assets/avatars/1.jpg",
      left_avatar_src: "../assets/avatars/1.jpg",
      right_avatar_src: "../assets/avatars/2.jpg",
    },
  };
}

export function validateConversationPlan(input: {
  conversationPlan: ConversationPlan;
  lineMap: LyricsLineMap;
  speakerAttribution: SpeakerAttribution;
  lineTimings?: LineTiming[];
}): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const lineById = new Map(input.lineMap.lines.map((line) => [line.line_id, line]));
  const assignmentByLine = new Map(input.speakerAttribution.assignments.map((assignment) => [assignment.line_id, assignment]));
  const sections = new Set(input.lineTimings?.map((timing) => timing.section_id) ?? input.conversationPlan.messages.map((message) => message.section_id));
  if (input.conversationPlan.schema_version !== 1) issues.push("conversation_plan.schema_version must be 1");
  if (input.conversationPlan.chain_id !== "chat_dialogue_mv") issues.push("conversation_plan.chain_id must be chat_dialogue_mv");
  if (input.conversationPlan.text_policy !== "verbatim_lyrics") issues.push("conversation_plan.text_policy must be verbatim_lyrics");
  if (input.conversationPlan.messages.length === 0) issues.push("conversation_plan.messages must not be empty");
  let previousStart = -Infinity;
  for (const message of input.conversationPlan.messages) {
    const line = lineById.get(message.source_line_id);
    const assignment = assignmentByLine.get(message.source_line_id);
    if (!line) issues.push(`${message.id} references unknown line ${message.source_line_id}`);
    if (line && message.raw_text !== line.raw_text) issues.push(`${message.id}.raw_text must match lyrics_line_map`);
    if (line && message.display_text !== line.display_text) issues.push(`${message.id}.display_text must match lyrics_line_map`);
    if (assignment && message.speaker !== assignment.speaker) issues.push(`${message.id}.speaker must match speaker_attribution`);
    if (assignment && message.side !== assignment.side) issues.push(`${message.id}.side must match speaker_attribution`);
    if (!Number.isFinite(message.start_sec) || !Number.isFinite(message.end_sec) || message.start_sec >= message.end_sec) {
      issues.push(`${message.id} must have a valid start/end time`);
    }
    if (message.start_sec < previousStart) issues.push("conversation_plan.messages must be sorted by start_sec");
    previousStart = message.start_sec;
    if (!sections.has(message.section_id)) issues.push(`${message.id}.section_id must trace to section_map`);
  }
  return { ok: issues.length === 0, issues };
}

function toMessage(
  index: number,
  line: LyricsLineMap["lines"][number],
  assignment: SpeakerAttribution["assignments"][number],
  timing: LineTiming,
): ConversationMessage {
  return {
    id: `msg_${String(index).padStart(3, "0")}`,
    source_line_id: line.line_id,
    speaker: assignment.speaker,
    side: assignment.side,
    raw_text: line.raw_text,
    display_text: line.display_text,
    text_policy: "verbatim_lyrics",
    attribution_source: assignment.attribution_source,
    start_sec: timing.start_sec,
    end_sec: timing.end_sec,
    section_id: timing.section_id,
    confidence: assignment.confidence,
  };
}
