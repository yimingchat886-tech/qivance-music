import path from "node:path";
import { writeJson } from "./fs-utils.ts";

export type QaStatus =
  | "running"
  | "rule_pass"
  | "rule_pass_with_warnings"
  | "rule_fail_blocked"
  | "human_pending"
  | "human_approved"
  | "skipped";

export type QaReportInput = {
  gate_name: string;
  status: QaStatus;
  blocking_issues?: string[];
  warnings?: string[];
  auto_fixes_applied?: string[];
  input_artifacts: string[];
  output_artifacts: string[];
  metadata?: Record<string, unknown>;
};

const secretKeyFragments = [
  "openai_api_key",
  "codex_api_key",
  "authorization",
  "token",
  "auth",
  "password",
  "secret",
];

export async function writeQaReport(
  projectPath: string,
  relativePath: string,
  input: QaReportInput,
): Promise<void> {
  await writeJson(path.join(projectPath, relativePath), {
    gate_name: input.gate_name,
    status: input.status,
    blocking_issues: input.blocking_issues ?? [],
    warnings: input.warnings ?? [],
    auto_fixes_applied: input.auto_fixes_applied ?? [],
    input_artifacts: input.input_artifacts,
    output_artifacts: input.output_artifacts,
    reviewer_type: input.status.startsWith("human") ? "human" : "rule",
    created_at: new Date().toISOString(),
    ...(input.metadata ? { metadata: scrubSecrets(input.metadata) } : {}),
  });
}

export function scrubSecrets<T>(value: T): T {
  return scrubValue(value) as T;
}

function scrubValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isSecretKey(key) ? "[REDACTED]" : scrubValue(item),
      ]),
    );
  }
  return value;
}

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return secretKeyFragments.some((fragment) => normalized.includes(fragment));
}
