import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runSceneRuleGate } from "../src/lib/scene-rule-gate.ts";

test("Scene Rule Gate returns human_pending for a valid storyboard", async () => {
  const projectPath = await writeSceneFixture();

  await runSceneRuleGate(projectPath);

  const report = await readReport(projectPath);
  assert.equal(report.status, "human_pending");
  assert.deepEqual(report.blocking_issues, []);
});

test("Scene Rule Gate blocks invalid templates and caption timing", async () => {
  const projectPath = await writeSceneFixture({
    scenes: [
      { scene_id: "scene_001", section_id: "sec_001", start_sec: 0, end_sec: 5, template: "bad_template" },
    ],
    captions: [
      { scene_id: "scene_001", start_sec: 6, end_sec: 7, text: "outside" },
    ],
  });

  await runSceneRuleGate(projectPath);

  const report = await readReport(projectPath);
  assert.equal(report.status, "rule_fail_blocked");
  assert.match(report.blocking_issues.join(" "), /template/);
  assert.match(report.blocking_issues.join(" "), /caption/);
});

test("Scene Rule Gate warns for pure atmosphere visual keywords", async () => {
  const projectPath = await writeSceneFixture({
    visuals: [{ scene_id: "scene_001", type: "concept_card", elements: ["particle", "flow"] }],
  });

  await runSceneRuleGate(projectPath);

  const report = await readReport(projectPath);
  assert.equal(report.status, "rule_pass_with_warnings");
  assert.match(report.warnings.join(" "), /particle/);
});

async function writeSceneFixture(overrides: {
  scenes?: unknown[];
  captions?: unknown[];
  visuals?: unknown[];
} = {}): Promise<string> {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-scene-gate-"));
  await writeJson(projectPath, "data/timing/beats.locked.json", { bars: [0, 4, 8] });
  await writeJson(projectPath, "data/timing/section_map.json", {
    duration_sec: 10,
    sections: [{ section_id: "sec_001", index: 0, label: "Verse", start_sec: 0, end_sec: 10, lyric_lines: [] }],
  });
  await writeJson(projectPath, "data/storyboard/scene_plan.json", {
    scenes: overrides.scenes ?? [
      { scene_id: "scene_001", section_id: "sec_001", start_sec: 0, end_sec: 5, template: "concept_card" },
    ],
  });
  await writeJson(projectPath, "data/storyboard/caption_plan.json", {
    captions: overrides.captions ?? [
      { scene_id: "scene_001", start_sec: 0.5, end_sec: 2, text: "caption" },
    ],
  });
  await writeJson(projectPath, "data/storyboard/visual_plan.json", {
    visuals: overrides.visuals ?? [{ scene_id: "scene_001", type: "concept_card", elements: ["flow"] }],
  });
  return projectPath;
}

async function readReport(projectPath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(projectPath, "qa", "storyboard", "scene_rule_check.json"), "utf8"));
}

async function writeJson(projectPath: string, relativePath: string, value: unknown): Promise<void> {
  const filePath = path.join(projectPath, relativePath);
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path.dirname(filePath), { recursive: true }));
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
