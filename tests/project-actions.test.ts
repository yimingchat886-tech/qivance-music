import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { importPastedStoryboard, startProjectHyperframesUi } from "../src/lib/project-actions.ts";

test("project actions import pasted storyboard from a urlencoded body", async () => {
  const projectPath = await createProject("project_action_storyboard");

  await importPastedStoryboard(
    projectPath,
    Buffer.from(new URLSearchParams({
      storyboardJson: JSON.stringify({
        scenes: [
          { scene_id: "scene_001", section_id: "sec_001", start_sec: 0, end_sec: 4 },
        ],
        captions: [],
        visuals: [],
      }),
    }).toString()),
  );

  const qa = JSON.parse(await readFile(path.join(projectPath, "qa", "storyboard", "scene_rule_check.json"), "utf8"));
  assert.equal(qa.status, "human_pending");
});

test("project actions start HyperFrames UI with a project-local runtime record", async () => {
  const projectPath = await createProject("project_action_hyperframes");
  const fakeHyperframes = path.join(path.dirname(projectPath), "fake-hyperframes.sh");
  await writeFile(fakeHyperframes, "#!/bin/sh\nsleep 30\n", "utf8");
  await chmod(fakeHyperframes, 0o755);

  const runtime = await startProjectHyperframesUi({
    projectPath,
    projectId: "project_action_hyperframes",
    requestHost: "192.168.1.25:3000",
    command: { executable: fakeHyperframes, prefixArgs: [] },
    findFreePort: async () => 3999,
  });

  try {
    assert.equal(runtime.project_id, "project_action_hyperframes");
    assert.equal(runtime.url, "http://192.168.1.25:3999/#project/hypeframes");
    const persisted = JSON.parse(await readFile(path.join(projectPath, "logs", "hyperframes_ui.json"), "utf8"));
    assert.equal(persisted.pid, runtime.pid);
  } finally {
    process.kill(runtime.pid, "SIGTERM");
  }
});

async function createProject(projectId: string): Promise<string> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "qivance-project-actions-"));
  const projectPath = path.join(tempRoot, projectId);
  await mkdir(path.join(projectPath, "hypeframes", "src"), { recursive: true });
  await writeFile(path.join(projectPath, "hypeframes", "src", "index.html"), "<!doctype html>", "utf8");
  await writeJson(path.join(projectPath, "project_manifest.json"), {
    project_id: projectId,
    current_workflow_state: "timing_passed",
  });
  await writeJson(path.join(projectPath, "workflow_snapshot.json"), {
    project_id: projectId,
    workflow_state: "timing_passed",
    next_allowed_actions: ["import_storyboard"],
  });
  return projectPath;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value), "utf8");
}
