import path from "node:path";
import { writeQaReport } from "./gate-report.ts";
import { diffProjectFileSnapshots, type ProjectFileSnapshot } from "./project-file-snapshot.ts";

const forbiddenPatterns = [
  "audio/**",
  "data/timing/**",
  "data/lyrics/**",
  "project_manifest.json",
  "workflow_snapshot.json",
  "dist/**",
  "qa/music/**",
  "qa/timing/**",
];

export async function runCodexForbiddenPathGate(input: {
  projectPath: string;
  before: ProjectFileSnapshot;
  after: ProjectFileSnapshot;
  changedFilesFromGit?: string[];
}): Promise<void> {
  const diff = diffProjectFileSnapshots(input.before, input.after);
  const changed = new Set([
    ...diff.added,
    ...diff.modified,
    ...diff.deleted,
    ...(input.changedFilesFromGit ?? []).filter((relativePath) => matchesForbiddenPath(relativePath)),
  ]);
  const blockingIssues = [...changed].sort().map((relativePath) => `Codex modified forbidden path: ${relativePath}`);

  await writeQaReport(input.projectPath, "qa/hypeframes/codex_forbidden_path_qa_report.json", {
    gate_name: "Codex Forbidden Path Gate",
    status: blockingIssues.length > 0 ? "rule_fail_blocked" : "rule_pass",
    blocking_issues: blockingIssues,
    input_artifacts: ["logs/codex/latest.changed_files.json"],
    output_artifacts: ["qa/hypeframes/codex_forbidden_path_qa_report.json"],
    metadata: {
      added: diff.added,
      modified: diff.modified,
      deleted: diff.deleted,
      changed_files_from_git: input.changedFilesFromGit ?? [],
    },
  });
}

export function forbiddenSnapshotIncludes(): string[] {
  return [...forbiddenPatterns];
}

function matchesForbiddenPath(relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join("/");
  return forbiddenPatterns.some((pattern) => {
    if (pattern.endsWith("/**")) {
      return normalized.startsWith(pattern.slice(0, -3) + "/");
    }
    return normalized === pattern;
  });
}
