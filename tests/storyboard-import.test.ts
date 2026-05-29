import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { importStoryboardFromJson, validateStoryboardPayload } from "../src/lib/storyboard-import.ts";

test("storyboard import rejects overlapping scene times", () => {
  assert.throws(
    () => validateStoryboardPayload({
      scenes: [
        { scene_id: "scene_001", section_id: "sec_001", start_sec: 0, end_sec: 3 },
        { scene_id: "scene_002", section_id: "sec_002", start_sec: 2.5, end_sec: 5 },
      ],
      captions: [],
      visuals: [],
    }),
    /overlap/i,
  );
});

test("storyboard import rejects non-finite scene timing", () => {
  assert.throws(
    () => validateStoryboardPayload({
      scenes: [
        { scene_id: "scene_001", section_id: "sec_001", start_sec: 0, end_sec: Number.NaN },
      ],
    }),
    /finite/i,
  );
});

test("storyboard import writes canonical artifacts and waits for human approval", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-storyboard-import-"));
  await writeFile(
    path.join(projectPath, "project_manifest.json"),
    JSON.stringify({
      project_id: "project_storyboard_test",
      current_workflow_state: "timing_passed",
      updated_at: "2026-05-29T00:00:00.000Z",
    }),
    "utf8",
  );
  await writeFile(
    path.join(projectPath, "workflow_snapshot.json"),
    JSON.stringify({
      project_id: "project_storyboard_test",
      workflow_state: "timing_passed",
      next_allowed_actions: ["import_storyboard"],
      updated_at: "2026-05-29T00:00:00.000Z",
    }),
    "utf8",
  );

  const result = await importStoryboardFromJson({
    projectPath,
    storyboardJson: JSON.stringify({
      scenes: [
        { scene_id: "scene_001", section_id: "sec_001", start_sec: 0, end_sec: 3 },
        { scene_id: "scene_002", section_id: "sec_002", start_sec: 3, end_sec: 6 },
      ],
      captions: [
        { scene_id: "scene_001", start_sec: 0, end_sec: 1.5, text: "恒星发光" },
      ],
      visuals: [
        { scene_id: "scene_001", type: "concept_card" },
      ],
    }),
  });

  assert.equal(result.sceneCount, 2);
  await stat(path.join(projectPath, "data", "storyboard", "scene_plan.json"));
  await stat(path.join(projectPath, "data", "storyboard", "caption_plan.json"));
  await stat(path.join(projectPath, "data", "storyboard", "visual_plan.json"));

  const qa = JSON.parse(await readFile(path.join(projectPath, "qa", "storyboard", "scene_rule_check.json"), "utf8"));
  const manifest = JSON.parse(await readFile(path.join(projectPath, "project_manifest.json"), "utf8"));
  const workflow = JSON.parse(await readFile(path.join(projectPath, "workflow_snapshot.json"), "utf8"));

  assert.equal(qa.status, "human_pending");
  assert.equal(manifest.current_workflow_state, "scene_waiting_human");
  assert.equal(workflow.workflow_state, "scene_waiting_human");
  assert.deepEqual(workflow.next_allowed_actions, ["approve_scene"]);
});
