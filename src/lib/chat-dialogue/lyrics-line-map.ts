import path from "node:path";
import { readFile } from "node:fs/promises";
import { sha256File, writeJson } from "../fs-utils.ts";

export type LyricsLineMap = {
  schema_version: 1;
  source: {
    lyrics_path: string;
    lyrics_sha256: string;
  };
  lines: LyricsLineMapLine[];
  excluded_lines: LyricsExcludedLine[];
};

export type LyricsLineMapLine = {
  line_id: string;
  line_number: number;
  line_type: "lyric";
  raw_text: string;
  display_text: string;
  prefix: string | null;
  text_policy: "verbatim_lyrics";
};

export type LyricsExcludedLine = {
  line_number: number;
  raw_text: string;
  reason: "blank_line" | "markdown_heading" | "section_label";
};

const PREFIXES = [
  "Question:",
  "Answer:",
  "提问：",
  "回答：",
  "问：",
  "答：",
  "甲：",
  "乙：",
  "Q:",
  "A:",
  "B:",
];

export function buildLyricsLineMap(input: {
  lyricsText: string;
  lyricsPath?: string;
  lyricsSha256?: string;
}): LyricsLineMap {
  const lines: LyricsLineMapLine[] = [];
  const excludedLines: LyricsExcludedLine[] = [];
  const sourceLines = input.lyricsText.split(/\r?\n/);
  for (let index = 0; index < sourceLines.length; index += 1) {
    const rawText = sourceLines[index] ?? "";
    const lineNumber = index + 1;
    const trimmed = rawText.trim();
    if (trimmed.length === 0) {
      excludedLines.push({ line_number: lineNumber, raw_text: rawText, reason: "blank_line" });
      continue;
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      excludedLines.push({ line_number: lineNumber, raw_text: rawText, reason: "markdown_heading" });
      continue;
    }
    if (/^\[[^\]]+\]$/.test(trimmed)) {
      excludedLines.push({ line_number: lineNumber, raw_text: rawText, reason: "section_label" });
      continue;
    }

    const prefix = findPrefix(trimmed);
    const displayText = (prefix ? trimmed.slice(prefix.length) : trimmed).trim();
    if (displayText.length === 0) {
      excludedLines.push({ line_number: lineNumber, raw_text: rawText, reason: "section_label" });
      continue;
    }
    lines.push({
      line_id: `line_${String(lines.length + 1).padStart(3, "0")}`,
      line_number: lineNumber,
      line_type: "lyric",
      raw_text: rawText,
      display_text: displayText,
      prefix,
      text_policy: "verbatim_lyrics",
    });
  }

  return {
    schema_version: 1,
    source: {
      lyrics_path: input.lyricsPath ?? "lyrics.md",
      lyrics_sha256: input.lyricsSha256 ?? "",
    },
    lines,
    excluded_lines: excludedLines,
  };
}

export async function writeLyricsLineMap(input: {
  projectRoot: string;
  lyricsPath?: string;
}): Promise<{ path: string; lineMap: LyricsLineMap }> {
  const relativeLyricsPath = input.lyricsPath ?? "lyrics.md";
  const absoluteLyricsPath = path.join(input.projectRoot, relativeLyricsPath);
  const lyricsText = await readFile(absoluteLyricsPath, "utf8");
  const lineMap = buildLyricsLineMap({
    lyricsText,
    lyricsPath: relativeLyricsPath,
    lyricsSha256: await sha256File(absoluteLyricsPath),
  });
  const relativePath = "data/chains/chat_dialogue_mv/lyrics_line_map.json";
  await writeJson(path.join(input.projectRoot, relativePath), lineMap);
  return { path: relativePath, lineMap };
}

export function validateLyricsLineMap(lineMap: LyricsLineMap): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (lineMap.schema_version !== 1) issues.push("lyrics_line_map.schema_version must be 1");
  if (!Array.isArray(lineMap.lines) || lineMap.lines.length === 0) issues.push("lyrics_line_map.lines must contain at least one lyric line");
  const ids = new Set<string>();
  for (const line of lineMap.lines) {
    if (ids.has(line.line_id)) issues.push(`duplicate line_id ${line.line_id}`);
    ids.add(line.line_id);
    if (line.display_text.trim().length === 0) issues.push(`${line.line_id}.display_text must not be empty`);
    if (line.text_policy !== "verbatim_lyrics") issues.push(`${line.line_id}.text_policy must be verbatim_lyrics`);
    if (line.prefix && !line.raw_text.trim().startsWith(line.prefix)) {
      issues.push(`${line.line_id}.prefix must match raw_text`);
    }
  }
  return { ok: issues.length === 0, issues };
}

function findPrefix(trimmedLine: string): string | null {
  return PREFIXES.find((prefix) => trimmedLine.startsWith(prefix)) ?? null;
}
