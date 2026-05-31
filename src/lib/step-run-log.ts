import path from "node:path";
import { writeFile } from "node:fs/promises";
import { ensureDir } from "./fs-utils.ts";
import { scrubSecrets } from "./gate-report.ts";

export async function appendStepRun(
  projectPath: string,
  input: {
    step_type: string;
    status: string;
    provider?: string;
    input_artifacts?: string[];
    output_artifacts?: string[];
    qa_report_ids?: string[];
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await ensureDir(path.join(projectPath, "logs"));
  await writeFile(
    path.join(projectPath, "logs", "step_runs.jsonl"),
    `${JSON.stringify({
      step_type: input.step_type,
      status: input.status,
      ...(input.provider ? { provider: input.provider } : {}),
      input_artifacts: input.input_artifacts ?? [],
      output_artifacts: input.output_artifacts ?? [],
      qa_report_ids: input.qa_report_ids ?? [],
      ...(input.metadata ? { metadata: scrubSecrets(input.metadata) } : {}),
      created_at: new Date().toISOString(),
    })}\n`,
    { flag: "a" },
  );
}
