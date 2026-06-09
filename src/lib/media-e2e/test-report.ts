import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export async function appendMediaE2ETestReportEvidence(input: {
  reportPath: string;
  ratio: string;
  manifestPath: string;
  status: "passed" | "failed";
}): Promise<void> {
  await mkdir(path.dirname(input.reportPath), { recursive: true });
  await appendFile(input.reportPath, [
    `## ${input.ratio}`,
    "",
    `- Status: ${input.status}`,
    `- Manifest: ${input.manifestPath}`,
    "",
  ].join("\n"), "utf8");
}
