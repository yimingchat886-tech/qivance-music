import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureHyperframesSkills } from "../src/lib/hypeframes-skills.ts";

test("ensureHyperframesSkills creates repo-scoped skills and QA", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-hypeframes-skills-"));

  const result = await ensureHyperframesSkills(projectPath);

  assert.equal(result.skillPaths.length, 3);
  const compositionSkill = await readFile(
    path.join(projectPath, "hypeframes", ".agents", "skills", "hyperframes-composition", "SKILL.md"),
    "utf8",
  );
  assert.match(compositionSkill, /^---\nname: hyperframes-composition\n/m);
  assert.match(compositionSkill, /beats\.locked\.json is the single timing source of truth/);
  assert.match(compositionSkill, /audio\/\*\*/);
  assert.match(compositionSkill, /dist\/\*\*/);

  const qa = JSON.parse(await readFile(path.join(projectPath, result.qaReportPath), "utf8"));
  assert.equal(qa.status, "rule_pass");
  assert.deepEqual(qa.blocking_issues, []);
});
