export type LyricSection = {
  label: string;
  lines: string[];
};

export type StructuredLyrics = {
  version: 1;
  sections: LyricSection[];
};

const sectionPattern = /^\s*\[([^\]]+)\]\s*$/;

export function parseLyrics(markdown: string): StructuredLyrics {
  const sections: LyricSection[] = [];
  let current: LyricSection | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const sectionMatch = line.match(sectionPattern);
    if (sectionMatch) {
      current = { label: sectionMatch[1].trim() || "Verse", lines: [] };
      sections.push(current);
      continue;
    }

    if (!current) {
      current = { label: "Verse", lines: [] };
      sections.push(current);
    }

    current.lines.push(line);
  }

  if (sections.length === 0) {
    return { version: 1, sections: [{ label: "Verse", lines: [] }] };
  }

  return { version: 1, sections };
}

