import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadGateProgress } from "../src/lib/gate-progress.ts";

test("gate progress maps project QA reports into visible stages", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-gate-progress-"));
  await writeJson(path.join(projectPath, "project_manifest.json"), {
    current_workflow_state: "timing_failed",
  });
  await writeJson(path.join(projectPath, "qa", "music", "music_ingest_qa_report.json"), {
    status: "rule_pass",
  });
  await writeJson(path.join(projectPath, "qa", "timing", "beat_lock_qa_report.json"), {
    status: "human_pending",
    warnings: ["Beat confidence is low."],
  });
  await writeJson(path.join(projectPath, "qa", "timing", "timing_qa_report.json"), {
    status: "rule_fail_blocked",
    blocking_issues: ["Section map overlaps."],
  });
  await writeJson(path.join(projectPath, "logs", "hyperframes_ui.json"), {
    status: "running",
    url: "http://192.168.1.10:3999/#project/hypeframes",
  });

  const progress = await loadGateProgress(projectPath);

  assert.deepEqual(progress.map((step) => step.id), [
    "music_ingest",
    "beat_lock",
    "timing_schema",
    "storyboard_gate",
    "hypeframes_project",
    "hyperframes_ui",
  ]);
  assert.equal(progress.find((step) => step.id === "music_ingest")?.status, "pass");
  assert.equal(progress.find((step) => step.id === "beat_lock")?.status, "warning");
  assert.equal(progress.find((step) => step.id === "timing_schema")?.status, "fail");
  assert.deepEqual(progress.find((step) => step.id === "timing_schema")?.issues, ["Section map overlaps."]);
  assert.equal(progress.find((step) => step.id === "hyperframes_ui")?.status, "pass");
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value), "utf8");
}
