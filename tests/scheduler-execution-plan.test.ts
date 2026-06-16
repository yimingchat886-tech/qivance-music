import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { writeJson } from "../src/lib/fs-utils.ts";
import { buildExecutionPlan, writeExecutionPlan } from "../src/lib/scheduler/execution-plan.ts";

test("builds chat dialogue execution plan with shared timing dependency", async () => {
  const storageRoot = await mkdtemp(path.join("/tmp", "qivance-execution-plan-"));
  await writeProjectFixture(storageRoot, "project_a", { timing: true });

  const plan = await buildExecutionPlan({
    storageRoot,
    projectId: "project_a",
    chains: ["chat_dialogue_mv"],
    runId: "run_001",
    now: "2026-06-15T00:00:00.000Z",
  });

  assert.equal(plan.schema_version, 1);
  assert.equal(plan.project_id, "project_a");
  assert.deepEqual(plan.chains, ["chat_dialogue_mv"]);
  assert.equal(plan.tasks.filter((task) => task.stage === "run_timing_pipeline").length, 1);
  assert.equal(plan.tasks.find((task) => task.stage === "resolve_timing_bundle")?.status, "skipped");

  const conversationTask = plan.tasks.find((task) => task.stage === "build_conversation_plan");
  assert.ok(conversationTask);
  assert.ok(conversationTask.dependencies.some((dependency) => dependency.includes("resolve_timing_bundle")));
});

test("single project multi-chain plan writes one timing writer", async () => {
  const storageRoot = await mkdtemp(path.join("/tmp", "qivance-execution-plan-"));
  await writeProjectFixture(storageRoot, "project_b", { timing: false });

  const plan = await buildExecutionPlan({
    storageRoot,
    projectId: "project_b",
    chains: ["chat_dialogue_mv", "source_video"],
    runId: "run_002",
    mode: "diagnostic",
    diagnosticAllowed: true,
  });

  assert.equal(plan.tasks.filter((task) => task.stage === "run_timing_pipeline").length, 1);
  assert.ok(plan.tasks.some((task) => task.stage === "run_existing_chain_source_video"));
  assert.equal(plan.tasks.find((task) => task.stage === "run_timing_pipeline")?.status, "ready");
});

test("production plan blocks missing timing pipeline when diagnostic fallback is not allowed", async () => {
  const storageRoot = await mkdtemp(path.join("/tmp", "qivance-execution-plan-"));
  await writeProjectFixture(storageRoot, "project_c", { timing: false });

  const plan = await buildExecutionPlan({
    storageRoot,
    projectId: "project_c",
    chains: ["chat_dialogue_mv"],
    runId: "run_003",
    mode: "production",
    diagnosticAllowed: false,
  });

  assert.equal(plan.tasks.find((task) => task.stage === "run_timing_pipeline")?.status, "blocked");
});

test("writes execution plan under project scheduler directory", async () => {
  const storageRoot = await mkdtemp(path.join("/tmp", "qivance-execution-plan-"));
  await writeProjectFixture(storageRoot, "project_d", { timing: true });
  const plan = await buildExecutionPlan({
    storageRoot,
    projectId: "project_d",
    chains: ["chat_dialogue_mv"],
    runId: "run_004",
  });

  const filePath = await writeExecutionPlan(storageRoot, plan);
  const written = JSON.parse(await readFile(filePath, "utf8"));

  assert.equal(written.run_id, "run_004");
  assert.match(filePath, /data\/scheduler\/execution_plan\.json$/);
});

async function writeProjectFixture(storageRoot: string, projectId: string, options: { timing: boolean }): Promise<void> {
  const projectRoot = path.join(storageRoot, projectId);
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "lyrics.md"), "问：hello?\n答：world\n", "utf8");
  await writeFile(path.join(projectRoot, "active_music_take.mp3"), "audio", "utf8");
  if (options.timing) {
    for (const artifactPath of [
      "data/timing/beat_grid.json",
      "data/timing/onset_events.json",
      "data/timing/energy_curve.json",
      "data/timing/lyric_word_timing.json",
      "data/timing/alignment_report.json",
      "data/timing/section_map.json",
    ]) {
      await writeJson(path.join(projectRoot, artifactPath), { schema_version: 1, path: artifactPath });
    }
  }
}
