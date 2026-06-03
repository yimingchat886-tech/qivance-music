import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCodexForbiddenPathGate } from "../src/lib/codex-forbidden-path-gate.ts";
import { snapshotProjectFiles } from "../src/lib/project-file-snapshot.ts";

const forbiddenIncludes = [
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

test("Codex forbidden path gate passes when only HypeFrames files changed", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-forbidden-pass-"));
  const before = await snapshotProjectFiles({ projectPath, include: forbiddenIncludes });
  await writeFileAt(projectPath, "hypeframes/src/index.html", "<!doctype html>");
  const after = await snapshotProjectFiles({ projectPath, include: forbiddenIncludes });

  await runCodexForbiddenPathGate({
    projectPath,
    before,
    after,
    changedFilesFromGit: ["hypeframes/src/index.html"],
  });

  const report = JSON.parse(await readFile(path.join(projectPath, "qa", "hypeframes", "codex_forbidden_path_qa_report.json"), "utf8"));
  assert.equal(report.status, "rule_pass");
});

test("Codex forbidden path gate blocks modified timing truth", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-forbidden-fail-"));
  await writeFileAt(projectPath, "data/timing/beats.locked.json", "{\"beats\":[0]}");
  const before = await snapshotProjectFiles({ projectPath, include: forbiddenIncludes });
  await writeFileAt(projectPath, "data/timing/beats.locked.json", "{\"beats\":[1]}");
  const after = await snapshotProjectFiles({ projectPath, include: forbiddenIncludes });

  await runCodexForbiddenPathGate({
    projectPath,
    before,
    after,
    changedFilesFromGit: ["data/timing/beats.locked.json"],
  });

  const report = JSON.parse(await readFile(path.join(projectPath, "qa", "hypeframes", "codex_forbidden_path_qa_report.json"), "utf8"));
  assert.equal(report.status, "rule_fail_blocked");
  assert.match(report.blocking_issues.join(" "), /data\/timing\/beats\.locked\.json/);
});

async function writeFileAt(projectPath: string, relativePath: string, value: string): Promise<void> {
  const filePath = path.join(projectPath, relativePath);
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path.dirname(filePath), { recursive: true }));
  await writeFile(filePath, value, "utf8");
}

test("Codex forbidden path gate blocks project cached HyperFrames skill modifications", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-forbidden-skills-fail-"));
  await writeFileAt(projectPath, "hypeframes/.agents/skills/hyperframes-composition/SKILL.md", "before");
  const before = await snapshotProjectFiles({ projectPath, include: forbiddenIncludes });
  await writeFileAt(projectPath, "hypeframes/.agents/skills/hyperframes-composition/SKILL.md", "after");
  const after = await snapshotProjectFiles({ projectPath, include: forbiddenIncludes });

  await runCodexForbiddenPathGate({
    projectPath,
    before,
    after,
    changedFilesFromGit: [],
  });

  const report = JSON.parse(await readFile(path.join(projectPath, "qa", "hypeframes", "codex_forbidden_path_qa_report.json"), "utf8"));
  assert.equal(report.status, "rule_fail_blocked");
  assert.match(
    report.blocking_issues.join(" "),
    /Codex attempted to modify HyperFrames skill files\. HyperFrames skills are read-only runtime dependencies and must not be changed by project-level runs\./,
  );
});

test("Codex forbidden path gate blocks skills reported by the nested hypeframes git repo", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-forbidden-skills-git-"));
  const before = await snapshotProjectFiles({ projectPath, include: forbiddenIncludes });
  const after = await snapshotProjectFiles({ projectPath, include: forbiddenIncludes });

  await runCodexForbiddenPathGate({
    projectPath,
    before,
    after,
    changedFilesFromGit: [".agents/skills/hyperframes-render-cli/SKILL.md"],
  });

  const report = JSON.parse(await readFile(path.join(projectPath, "qa", "hypeframes", "codex_forbidden_path_qa_report.json"), "utf8"));
  assert.equal(report.status, "rule_fail_blocked");
  assert.match(report.blocking_issues.join(" "), /HyperFrames skills are read-only runtime dependencies/);
});
