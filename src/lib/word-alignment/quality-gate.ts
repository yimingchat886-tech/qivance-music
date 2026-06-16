import type { WordAlignmentMetrics } from "./types.ts";

export function evaluateWordAlignmentQuality(metrics: WordAlignmentMetrics): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const wordCoverage = metrics.totalWords === 0 ? 0 : metrics.alignedWords / metrics.totalWords;
  const lowConfidenceRatio = metrics.totalWords === 0 ? 1 : metrics.lowConfidenceWords / metrics.totalWords;
  const unmatchedRatio = metrics.totalWords === 0 ? 1 : metrics.unmatchedWords / metrics.totalWords;

  if (wordCoverage < 0.85) issues.push("word coverage must be >= 85%");
  if (lowConfidenceRatio > 0.15) issues.push("low confidence words must be <= 15%");
  if (unmatchedRatio > 0.10) issues.push("unmatched words must be <= 10%");
  if (metrics.sectionDurationCoverage < 0.98) issues.push("section duration coverage must be >= 98%");
  if (metrics.sectionBoundaryEvidenceDriftSec > 0.5) {
    issues.push("section boundary evidence drift must be <= 0.5s");
  }

  return { ok: issues.length === 0, issues };
}
