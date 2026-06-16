import type { LyricsLineMap } from "./lyrics-line-map.ts";

export type WordTiming = {
  word: string;
  start_sec: number;
  end_sec: number;
  line_id?: string;
};

export type LyricWordTiming = {
  schema_version?: number;
  duration_sec?: number;
  words: WordTiming[];
};

export type SectionMapSection = {
  section_id: string;
  scene_id?: string;
  start_sec: number;
  end_sec: number;
};

export type SectionMapLike = {
  duration_sec?: number;
  sections: SectionMapSection[];
};

export type LineTiming = {
  line_id: string;
  start_sec: number;
  end_sec: number;
  section_id: string;
  coverage: number;
  timing_source: "lyric_word_timing" | "diagnostic_even_split";
};

export function buildLineTimings(input: {
  lineMap: LyricsLineMap;
  lyricWordTiming?: LyricWordTiming | null;
  sectionMap: SectionMapLike;
  allowDiagnosticFallback?: boolean;
  minCoverage?: number;
}): { timings: LineTiming[]; diagnosticFallbackUsed: boolean; issues: string[] } {
  const minCoverage = input.minCoverage ?? 0.6;
  if (input.lyricWordTiming?.words?.length) {
    const byLineId = timingsFromExplicitLineIds(input.lineMap, input.lyricWordTiming.words, input.sectionMap, minCoverage);
    if (byLineId.timings.length === input.lineMap.lines.length && byLineId.issues.length === 0) {
      return { timings: byLineId.timings, diagnosticFallbackUsed: false, issues: [] };
    }
    const bySequence = timingsFromWordSequence(input.lineMap, input.lyricWordTiming.words, input.sectionMap, minCoverage);
    if (bySequence.timings.length === input.lineMap.lines.length && bySequence.issues.length === 0) {
      return { timings: bySequence.timings, diagnosticFallbackUsed: false, issues: [] };
    }
    if (!input.allowDiagnosticFallback) return { timings: [], diagnosticFallbackUsed: false, issues: [...byLineId.issues, ...bySequence.issues] };
  }
  if (!input.allowDiagnosticFallback) return { timings: [], diagnosticFallbackUsed: false, issues: ["lyric_word_timing is required for production chat timing"] };
  return { timings: diagnosticEvenSplit(input.lineMap, input.sectionMap), diagnosticFallbackUsed: true, issues: [] };
}

function timingsFromExplicitLineIds(
  lineMap: LyricsLineMap,
  words: WordTiming[],
  sectionMap: SectionMapLike,
  minCoverage: number,
): { timings: LineTiming[]; issues: string[] } {
  const issues: string[] = [];
  const timings: LineTiming[] = [];
  for (const line of lineMap.lines) {
    const lineWords = words.filter((word) => word.line_id === line.line_id);
    const expectedCount = normalizeWords(line.display_text).length;
    const coverage = expectedCount === 0 ? 0 : Math.min(1, lineWords.length / expectedCount);
    if (lineWords.length === 0 || coverage < minCoverage) {
      issues.push(`${line.line_id} coverage ${coverage.toFixed(2)} is below ${minCoverage}`);
      continue;
    }
    timings.push(toLineTiming(line.line_id, lineWords, sectionMap, coverage, "lyric_word_timing"));
  }
  return { timings, issues };
}

function timingsFromWordSequence(
  lineMap: LyricsLineMap,
  words: WordTiming[],
  sectionMap: SectionMapLike,
  minCoverage: number,
): { timings: LineTiming[]; issues: string[] } {
  const issues: string[] = [];
  const timings: LineTiming[] = [];
  let cursor = 0;
  for (const line of lineMap.lines) {
    const expectedWords = normalizeWords(line.display_text);
    if (expectedWords.length === 0) {
      issues.push(`${line.line_id} has no normalized words`);
      continue;
    }
    const matched: WordTiming[] = [];
    for (const expected of expectedWords) {
      const nextIndex = words.findIndex((word, index) => index >= cursor && normalizeWord(word.word) === expected);
      if (nextIndex === -1) continue;
      matched.push(words[nextIndex]!);
      cursor = nextIndex + 1;
    }
    const coverage = matched.length / expectedWords.length;
    if (coverage < minCoverage) {
      issues.push(`${line.line_id} coverage ${coverage.toFixed(2)} is below ${minCoverage}`);
      continue;
    }
    timings.push(toLineTiming(line.line_id, matched, sectionMap, coverage, "lyric_word_timing"));
  }
  return { timings, issues };
}

function diagnosticEvenSplit(lineMap: LyricsLineMap, sectionMap: SectionMapLike): LineTiming[] {
  const duration = sectionMap.duration_sec ?? sectionMap.sections.at(-1)?.end_sec ?? Math.max(1, lineMap.lines.length);
  const slice = duration / Math.max(1, lineMap.lines.length);
  return lineMap.lines.map((line, index) => {
    const start = index * slice;
    const end = Math.max(start + 0.6, (index + 1) * slice);
    return {
      line_id: line.line_id,
      start_sec: start,
      end_sec: end,
      section_id: sectionForTime(sectionMap, start).section_id,
      coverage: 0,
      timing_source: "diagnostic_even_split",
    };
  });
}

function toLineTiming(
  lineId: string,
  words: WordTiming[],
  sectionMap: SectionMapLike,
  coverage: number,
  timingSource: LineTiming["timing_source"],
): LineTiming {
  const start = Math.min(...words.map((word) => word.start_sec));
  const end = Math.max(...words.map((word) => word.end_sec));
  return {
    line_id: lineId,
    start_sec: start,
    end_sec: end,
    section_id: sectionForTime(sectionMap, start).section_id,
    coverage,
    timing_source: timingSource,
  };
}

function sectionForTime(sectionMap: SectionMapLike, startSec: number): SectionMapSection {
  return sectionMap.sections.find((section) => startSec >= section.start_sec && startSec < section.end_sec) ?? sectionMap.sections[0] ?? {
    section_id: "sec_001",
    start_sec: 0,
    end_sec: Number.POSITIVE_INFINITY,
  };
}

function normalizeWords(text: string): string[] {
  return text.split(/\s+/).map(normalizeWord).filter(Boolean);
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
}
