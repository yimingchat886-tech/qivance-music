import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export async function appendMediaE2ETestReportEvidence(input: {
  reportPath: string;
  ratio: string;
  manifestPath: string;
  status: "passed" | "failed";
  evidenceStatus?: {
    liveImagegenPassed: boolean;
    aiAuthoredFramesPassed: boolean;
    reviewDecisionSource: string | null;
  };
}): Promise<void> {
  await mkdir(path.dirname(input.reportPath), { recursive: true });
  const lines = [
    `## ${input.ratio}`,
    "",
    `- Status: ${input.status}`,
    `- Manifest: ${input.manifestPath}`,
  ];
  if (input.evidenceStatus) {
    lines.push(`- Live imagegen: ${input.evidenceStatus.liveImagegenPassed ? "passed" : "failed"}`);
    lines.push(`- AI-authored frames: ${input.evidenceStatus.aiAuthoredFramesPassed ? "passed" : "failed"}`);
    lines.push(`- Review decision source: ${input.evidenceStatus.reviewDecisionSource ?? "none"}`);
  }
  lines.push("");
  await appendFile(input.reportPath, lines.join("\n"), "utf8");
}
