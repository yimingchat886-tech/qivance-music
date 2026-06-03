import assert from "node:assert/strict";
import test from "node:test";
import { loadHyperframesSkillsResource, validateHyperframesSkillsResourcePath } from "../src/lib/hyperframes-skills-resource.ts";

test("loads the qivance app-global HyperFrames skills resource", async () => {
  const resource = await loadHyperframesSkillsResource();

  assert.equal(resource.name, "qivance-hyperframes-skills");
  assert.equal(resource.version, "1.0.0");
  assert.equal(resource.source, "qivance-app:resources/hyperframes-skills/v1");
  assert.match(resource.hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(resource.files.map((file) => file.relativePath).sort(), [
    "hyperframes-composition/SKILL.md",
    "hyperframes-composition/references/project-contract.md",
    "hyperframes-gate-repair/SKILL.md",
    "hyperframes-gate-repair/references/gate-contract.md",
    "hyperframes-render-cli/SKILL.md",
    "hyperframes-render-cli/references/render-targets.md",
  ]);
  assert.ok(resource.files.every((file) => file.content.length > 0));
  assert.ok(
    resource.files
      .find((file) => file.relativePath === "hyperframes-composition/SKILL.md")
      ?.content.includes("data/timing/**"),
  );
});
test("validates HyperFrames skills resource paths before URL resolution", () => {
  for (const relativePath of [
    "",
    "/absolute/SKILL.md",
    "../outside/SKILL.md",
    "hyperframes-composition/../outside.md",
    "file:///tmp/SKILL.md",
    "https://example.com/SKILL.md",
    "hyperframes-composition\\SKILL.md",
    "%2e%2e/outside.md",
  ]) {
    assert.throws(
      () => validateHyperframesSkillsResourcePath(relativePath),
      /Invalid HyperFrames skills resource path/,
    );
  }

  const valid = validateHyperframesSkillsResourcePath("hyperframes-composition/SKILL.md");
  assert.equal(
    valid.href.endsWith("/resources/hyperframes-skills/v1/hyperframes-composition/SKILL.md"),
    true,
  );
});
