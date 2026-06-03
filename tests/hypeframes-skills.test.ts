import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureHyperframesSkills } from "../src/lib/hypeframes-skills.ts";
import { loadHyperframesSkillsResource, type HyperframesSkillsResource } from "../src/lib/hyperframes-skills-resource.ts";

test("ensureHyperframesSkills prepares app-global skills as a project runtime cache with audit metadata", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-hypeframes-skills-"));

  const result = await ensureHyperframesSkills(projectPath);

  assert.equal(result.name, "qivance-hyperframes-skills");
  assert.equal(result.version, "1.0.0");
  assert.match(result.hash, /^[a-f0-9]{64}$/);
  assert.equal(result.source, "qivance-app:resources/hyperframes-skills/v1");
  assert.equal(result.cacheStatus, "created");
  assert.equal(result.qaReportPath, "qa/hypeframes/hyperframes_skills_qa_report.json");
  assert.equal(result.statusPath, "qa/hypeframes/hyperframes_skills_status.json");
  assert.equal(result.skillPaths.length, 3);

  const compositionSkill = await readFile(
    path.join(projectPath, "hypeframes", ".agents", "skills", "hyperframes-composition", "SKILL.md"),
    "utf8",
  );
  assert.match(compositionSkill, /^---\nname: hyperframes-composition\n/m);
  assert.match(compositionSkill, /beats\.locked\.json is the single timing source of truth/);
  assert.match(compositionSkill, /audio\/\*\*/);
  assert.match(compositionSkill, /dist\/\*\*/);

  const status = JSON.parse(await readFile(path.join(projectPath, result.statusPath), "utf8"));
  assert.equal(status.name, result.name);
  assert.equal(status.version, result.version);
  assert.equal(status.hash, result.hash);
  assert.equal(status.cache_status, "created");
  assert.equal(status.success, true);
  assert.deepEqual(status.failure_reason, null);

  const qa = JSON.parse(await readFile(path.join(projectPath, result.qaReportPath), "utf8"));
  assert.equal(qa.status, "rule_pass");
  assert.equal(qa.metadata.version, result.version);
  assert.equal(qa.metadata.hash, result.hash);
  assert.equal(qa.metadata.cache_status, "created");
});

test("ensureHyperframesSkills reuses an unchanged runtime cache", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-hypeframes-skills-reuse-"));

  await ensureHyperframesSkills(projectPath);
  const reused = await ensureHyperframesSkills(projectPath);

  assert.equal(reused.cacheStatus, "reused");
  const status = JSON.parse(await readFile(path.join(projectPath, reused.statusPath), "utf8"));
  assert.equal(status.cache_status, "reused");
});

test("ensureHyperframesSkills writes failed audit metadata when cache preparation fails", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-hypeframes-skills-fail-"));
  await writeFile(path.join(projectPath, "hypeframes"), "not a directory", "utf8");

  await assert.rejects(
    () => ensureHyperframesSkills(projectPath),
    /Failed to prepare HyperFrames skills:/,
  );

  const status = JSON.parse(
    await readFile(path.join(projectPath, "qa", "hypeframes", "hyperframes_skills_status.json"), "utf8"),
  );
  assert.equal(status.name, "qivance-hyperframes-skills");
  assert.equal(status.version, "1.0.0");
  assert.equal(status.cache_status, "failed");
  assert.equal(status.success, false);
  assert.match(status.failure_reason, /Failed to prepare HyperFrames skills:/);

  const qa = JSON.parse(
    await readFile(path.join(projectPath, "qa", "hypeframes", "hyperframes_skills_qa_report.json"), "utf8"),
  );
  assert.equal(qa.status, "rule_fail_blocked");
  assert.match(qa.blocking_issues[0], /Failed to prepare HyperFrames skills:/);
  assert.equal(qa.metadata.cache_status, "failed");
});

test("ensureHyperframesSkills updates the runtime cache when the app-global resource version changes", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-hypeframes-skills-update-"));
  const resource = await loadHyperframesSkillsResource();

  await ensureHyperframesSkills(projectPath, { resource });
  const changedResource: HyperframesSkillsResource = {
    ...resource,
    version: "1.0.1",
    hash: "f".repeat(64),
    files: resource.files.map((file) =>
      file.relativePath === "hyperframes-composition/SKILL.md"
        ? { ...file, content: `${file.content}\nRuntime cache update test.\n`, sha256: "e".repeat(64) }
        : file
    ),
  };
  const updated = await ensureHyperframesSkills(projectPath, { resource: changedResource });

  assert.equal(updated.version, "1.0.1");
  assert.equal(updated.cacheStatus, "updated");
  const compositionSkill = await readFile(
    path.join(projectPath, "hypeframes", ".agents", "skills", "hyperframes-composition", "SKILL.md"),
    "utf8",
  );
  assert.match(compositionSkill, /Runtime cache update test/);
});
