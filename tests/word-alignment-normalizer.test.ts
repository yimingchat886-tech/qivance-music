import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLyricsMarkdown } from "../src/lib/word-alignment/lyrics-normalizer.ts";

test("normalizes lyrics while preserving source words and order", () => {
  const normalized = normalizeLyricsMarkdown("## Hook\nRAG isn't magic.\n\n## Outro\nRAG returns facts!");

  assert.deepEqual(
    normalized.words.map((word) => word.text),
    ["RAG", "isn't", "magic", "RAG", "returns", "facts"],
  );
  assert.equal(normalized.words[0]?.paragraphId, "p_001");
  assert.equal(normalized.words[3]?.paragraphId, "p_002");
});
