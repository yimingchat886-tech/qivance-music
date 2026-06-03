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
  "hypeframes/.agents/skills/**",
];

const nestedHypeframesForbiddenPatterns = [
  ".agents/skills/**",
];

const hyperframesSkillsError =
  "Codex attempted to modify HyperFrames skill files. HyperFrames skills are read-only runtime dependencies and must not be changed by project-level runs.";

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
  const blockingIssues = [...changed].sort().map((relativePath) =>
    isHyperframesSkillsPath(relativePath)
      ? `${hyperframesSkillsError} Path: ${relativePath}`
      : `Codex modified forbidden path: ${relativePath}`
  );

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
  const normalized = normalizeRelativePath(relativePath);
  return [...forbiddenPatterns, ...nestedHypeframesForbiddenPatterns].some((pattern) => matchesPattern(normalized, pattern));
}

function isHyperframesSkillsPath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath);
  return matchesPattern(normalized, "hypeframes/.agents/skills/**") || matchesPattern(normalized, ".agents/skills/**");
}

function matchesPattern(relativePath: string, pattern: string): boolean {
  if (pattern.endsWith("/**")) {
    return relativePath.startsWith(pattern.slice(0, -3) + "/");
  }
  return relativePath === pattern;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/").replace(/^\.\/+/, "");
}
