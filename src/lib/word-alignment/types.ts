export type LyricsWord = {
  wordId: string;
  paragraphId: string;
  lineId: string;
  text: string;
  normalizedText: string;
};

export type WordAlignmentMetrics = {
  totalWords: number;
  alignedWords: number;
  lowConfidenceWords: number;
  unmatchedWords: number;
  sectionDurationCoverage: number;
  sectionBoundaryEvidenceDriftSec: number;
};
