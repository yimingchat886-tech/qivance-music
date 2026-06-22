import path from "node:path";
import { writeJson } from "../fs-utils.ts";
import type { LyricsLineMap } from "./lyrics-line-map.ts";

export type ChatSpeakerId = "questioner" | "answerer";
export type ChatSpeakerSide = "left" | "right";

export type SpeakerAttribution = {
  schema_version: 1;
  source_lyrics_line_map_sha256: string;
  speakers: Array<{ id: ChatSpeakerId; label: string; side: ChatSpeakerSide }>;
  assignments: SpeakerAssignment[];
  low_confidence_count: number;
};

export type SpeakerAssignment = {
  line_id: string;
  speaker: ChatSpeakerId;
  side: ChatSpeakerSide;
  attribution_source:
    | "explicit_role_prefix"
    | "explicit_question_prefix"
    | "explicit_answer_prefix"
    | "question_punctuation_or_word"
    | "context_alternation"
    | "default_fallback";
  confidence: number;
};

export function buildSpeakerAttribution(input: {
  lineMap: LyricsLineMap;
  lineMapSha256?: string;
}): SpeakerAttribution {
  const assignments: SpeakerAssignment[] = [];
  for (const line of input.lineMap.lines) {
    const assignment = attributeLine(line.display_text);
    assignments.push({ line_id: line.line_id, ...assignment });
  }
  return {
    schema_version: 1,
    source_lyrics_line_map_sha256: input.lineMapSha256 ?? "",
    speakers: [
      { id: "questioner", label: "提问者", side: "right" },
      { id: "answerer", label: "回答者", side: "left" },
    ],
    assignments,
    low_confidence_count: assignments.filter((assignment) => assignment.confidence < 0.7).length,
  };
}

export async function writeSpeakerAttribution(input: {
  projectRoot: string;
  lineMap: LyricsLineMap;
  lineMapSha256?: string;
}): Promise<{ path: string; speakerAttribution: SpeakerAttribution }> {
  const speakerAttribution = buildSpeakerAttribution(input);
  const relativePath = "data/chains/chat_dialogue_mv/speaker_attribution.json";
  await writeJson(path.join(input.projectRoot, relativePath), speakerAttribution);
  return { path: relativePath, speakerAttribution };
}

export function validateSpeakerAttribution(input: {
  lineMap: LyricsLineMap;
  speakerAttribution: SpeakerAttribution;
}): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (input.speakerAttribution.schema_version !== 1) issues.push("speaker_attribution.schema_version must be 1");
  const lineIds = new Set(input.lineMap.lines.map((line) => line.line_id));
  if (input.speakerAttribution.assignments.length !== input.lineMap.lines.length) {
    issues.push("speaker_attribution.assignments length must match lyrics_line_map.lines");
  }
  for (const assignment of input.speakerAttribution.assignments) {
    const line = input.lineMap.lines.find((candidate) => candidate.line_id === assignment.line_id);
    if (!lineIds.has(assignment.line_id)) issues.push(`assignment references unknown line ${assignment.line_id}`);
    if (assignment.speaker === "questioner" && assignment.side !== "right") issues.push(`${assignment.line_id}.questioner must be on right`);
    if (assignment.speaker === "answerer" && assignment.side !== "left") issues.push(`${assignment.line_id}.answerer must be on left`);
    if (line && hasQuestionMark(line.display_text) && (assignment.speaker !== "questioner" || assignment.side !== "right")) {
      issues.push(`${assignment.line_id}.question text must be questioner on right`);
    }
    if (line && !hasQuestionMark(line.display_text) && (assignment.speaker !== "answerer" || assignment.side !== "left")) {
      issues.push(`${assignment.line_id}.non-question text must be answerer on left`);
    }
    if (assignment.confidence < 0 || assignment.confidence > 1) issues.push(`${assignment.line_id}.confidence must be between 0 and 1`);
  }
  return { ok: issues.length === 0, issues };
}

function attributeLine(displayText: string): Omit<SpeakerAssignment, "line_id"> {
  return hasQuestionMark(displayText)
    ? question("question_punctuation_or_word", 1)
    : answer("default_fallback", 1);
}

function question(source: SpeakerAssignment["attribution_source"], confidence: number): Omit<SpeakerAssignment, "line_id"> {
  return { speaker: "questioner", side: "right", attribution_source: source, confidence };
}

function answer(source: SpeakerAssignment["attribution_source"], confidence: number): Omit<SpeakerAssignment, "line_id"> {
  return { speaker: "answerer", side: "left", attribution_source: source, confidence };
}

function hasQuestionMark(displayText: string): boolean {
  return displayText.includes("？") || displayText.includes("?");
}
