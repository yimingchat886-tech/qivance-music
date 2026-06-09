import type { LyricsWord } from "./types.ts";

export function normalizeLyricsMarkdown(markdown: string): { words: LyricsWord[] } {
  const paragraphs = markdown
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.split(/\n+/).filter((line) => !line.trimStart().startsWith("#")).join("\n").trim())
    .filter(Boolean);
  const words: LyricsWord[] = [];

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraphId = `p_${String(paragraphIndex + 1).padStart(3, "0")}`;
    const lines = paragraphs[paragraphIndex]!.split(/\n+/).map((line) => line.trim()).filter(Boolean);

    for (const line of lines) {
      const lineId = `line_${String(words.length + 1).padStart(3, "0")}`;
      for (const raw of line.split(/\s+/)) {
        const text = raw.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
        if (!text) continue;
        words.push({
          wordId: `w_${String(words.length + 1).padStart(6, "0")}`,
          paragraphId,
          lineId,
          text,
          normalizedText: text.toLowerCase(),
        });
      }
    }
  }

  return { words };
}
