import assert from "node:assert/strict";
import test from "node:test";
import { renderWorkbenchProjectDetailPage, renderWorkbenchProjectsPage } from "../src/lib/workbench/workbench-html.ts";
import { readWorkbenchProjectStatus } from "../src/lib/workbench/project-status.ts";

test("renders project list with status summary and project links", () => {
  const html = renderWorkbenchProjectsPage({
    projects: [
      {
        small_project_id: "media_e2e_v2_portrait_9x16",
        mode: "image_music_mode",
        status: "ready",
        project_root: "projects/media_e2e_v2_portrait_9x16",
      },
    ],
  });

  assert.match(html, /Qivance Workbench/);
  assert.match(html, /media_e2e_v2_portrait_9x16/);
  assert.match(html, /image_music_mode/);
  assert.match(html, /\/projects\/media_e2e_v2_portrait_9x16/);
});

test("renders existing V2 fixture project detail with required Workbench sections", async () => {
  const status = await readWorkbenchProjectStatus({
    storageRoot: "projects",
    smallProjectId: "media_e2e_v2_portrait_9x16",
  });
  const html = renderWorkbenchProjectDetailPage({ status });

  for (const label of [
    "Input Diagnostics",
    "Workflow Steps",
    "Animation Plan Approval",
    "Image Schedule",
    "Image Prompt Group",
    "Image Review",
    "Source MP4",
    "Preview",
    "Revision",
    "Agent Runs",
    "Export",
  ]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /const projectId = "media_e2e_v2_portrait_9x16"/);
  assert.match(html, /\/animation-plan\/approve/);
  assert.match(html, /\/source-video\/import/);
  assert.match(html, /\/html-video\/revise/);
  assert.match(html, /location\.reload/);
  assert.doesNotMatch(html, /Studio/i);
});
