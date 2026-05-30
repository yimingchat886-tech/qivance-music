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
  await writeJson(path.join(projectPath, "audio", "music_manifest.json"), {
    duration_sec: 4,
  });
  await writeJson(path.join(projectPath, "data", "timing", "beats.locked.json"), {
    beats: [0, 1],
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
  const musicStep = progress.find((step) => step.id === "music_ingest");
  const beatStep = progress.find((step) => step.id === "beat_lock");
  const timingStep = progress.find((step) => step.id === "timing_schema");

  assert.equal(musicStep?.status, "pass");
  assert.equal(musicStep?.qaPath, "qa/music/music_ingest_qa_report.json");
  assert.equal(musicStep?.completed, true);
  assert.ok((musicStep?.artifactCount ?? 0) >= 5);
  assert.equal(musicStep?.availableArtifactCount, 2);

  assert.equal(beatStep?.status, "warning");
  assert.equal(beatStep?.qaPath, "qa/timing/beat_lock_qa_report.json");
  assert.equal(beatStep?.completed, false);
  assert.ok((beatStep?.artifactCount ?? 0) >= 4);
  assert.equal(beatStep?.availableArtifactCount, 2);

  assert.equal(timingStep?.status, "fail");
  assert.equal(timingStep?.qaPath, "qa/timing/timing_qa_report.json");
  assert.equal(timingStep?.completed, false);
  assert.ok((timingStep?.artifactCount ?? 0) >= 3);
  assert.equal(timingStep?.availableArtifactCount, 1);
  assert.deepEqual(timingStep?.issues, ["Section map overlaps."]);
  assert.equal(progress.find((step) => step.id === "hyperframes_ui")?.status, "pass");
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value), "utf8");
}
