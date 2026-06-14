import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readWorkbenchProjectStatus } from "../src/lib/workbench/project-status.ts";

test("reads a meaningful status object from an existing V2 media project", async () => {
  const status = await readWorkbenchProjectStatus({
    storageRoot: path.resolve("projects"),
    smallProjectId: "media_e2e_v2_portrait_9x16",
  });

  assert.equal(status.schema_version, 1);
  assert.equal(status.mode, "image_music_mode");
  assert.equal(status.primary_ratio, "9:16");
  assert.equal(status.inputs.active_music_take.exists, true);
  assert.equal(status.inputs.active_music_take.path, "audio/master/active_music_take.mp3");
  assert.equal(status.inputs.animation_plan.exists, true);
  assert.equal(status.inputs.animation_plan.path, "qivance/animation_plan.json");
  assert.equal(status.inputs.image_generation_plan.exists, false);
  assert.equal(step(status, "timing").status, "passed");
  assert.equal(step(status, "image_review").status, "passed");
  assert.equal(step(status, "export").status, "passed");
  assert.equal(status.export.final_mp4.exists, true);
  assert.match(artifact(status, "render_manifest").sha256 ?? "", /^[a-f0-9]{64}$/);
  assert.ok(status.blocking_reasons.some((reason) => reason.code === "animation_plan_unapproved"));
});

test("reports blocked mode and explicit reasons when required inputs are missing", async () => {
  const storageRoot = await mkdtemp(path.join("/tmp", "qivance-workbench-status-empty-"));
  await mkdir(path.join(storageRoot, "empty_project"), { recursive: true });

  const status = await readWorkbenchProjectStatus({ storageRoot, smallProjectId: "empty_project" });

  assert.equal(status.mode, "blocked");
  assert.equal(status.overall_status, "blocked");
  assert.deepEqual(
    status.blocking_reasons.map((reason) => reason.code),
    ["no_supported_input_mode", "animation_plan_missing"],
  );
  assert.equal(step(status, "validate_input").status, "blocked");
});

test("detects source video mode from source import metadata", async () => {
  const storageRoot = await mkdtemp(path.join("/tmp", "qivance-workbench-status-source-"));
  const projectRoot = path.join(storageRoot, "source_demo");
  await mkdir(path.join(projectRoot, "data", "source"), { recursive: true });
  await writeJson(path.join(projectRoot, "animation_plan.json"), {
    schema_version: 1,
    small_project_id: "source_demo",
    aspect_ratio: "16:9",
  });
  await writeJson(path.join(projectRoot, "workflow_checkpoints.json"), {
    animation_plan: { approved: true },
  });
  await writeJson(path.join(projectRoot, "data", "source", "source_video_import.json"), {
    schema_version: 1,
    small_project_id: "source_demo",
    source_video: { path: "source_video.mp4", sha256: "abc" },
    audio_policy: "preserve_source_audio",
    status: "locked",
  });

  const status = await readWorkbenchProjectStatus({ storageRoot, smallProjectId: "source_demo" });

  assert.equal(status.mode, "source_video_mode");
  assert.equal(status.primary_ratio, "16:9");
  assert.equal(status.inputs.source_video.exists, true);
  assert.equal(status.inputs.source_video.path, "data/source/source_video_import.json");
  assert.equal(status.inputs.animation_plan.approved, true);
  assert.equal(step(status, "timing").status, "not_started");
  assert.equal(status.blocking_reasons.length, 0);
});

test("requires explicit mode selection when image/music and source video inputs both exist", async () => {
  const storageRoot = await mkdtemp(path.join("/tmp", "qivance-workbench-status-conflict-"));
  const projectRoot = path.join(storageRoot, "conflict_demo");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "active_music_take.mp3"), "audio", "utf8");
  await writeFile(path.join(projectRoot, "lyrics.md"), "lyrics", "utf8");
  await writeJson(path.join(projectRoot, "image_generation_plan.json"), { schema_version: 1 });
  await writeJson(path.join(projectRoot, "animation_plan.json"), { schema_version: 1, aspectRatio: "9:16" });
  await writeJson(path.join(projectRoot, "workflow_checkpoints.json"), { animation_plan_approved: true });
  await writeFile(path.join(projectRoot, "source_video.mp4"), "video", "utf8");

  const status = await readWorkbenchProjectStatus({ storageRoot, smallProjectId: "conflict_demo" });

  assert.equal(status.mode, "conflict");
  assert.equal(status.overall_status, "blocked");
  assert.ok(status.blocking_reasons.some((reason) => reason.code === "mode_conflict"));
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function step(status: Awaited<ReturnType<typeof readWorkbenchProjectStatus>>, id: string) {
  const value = status.steps.find((candidate) => candidate.id === id);
  assert.ok(value, `Expected step ${id}`);
  return value;
}

function artifact(status: Awaited<ReturnType<typeof readWorkbenchProjectStatus>>, id: string) {
  const value = status.artifacts.find((candidate) => candidate.id === id);
  assert.ok(value, `Expected artifact ${id}`);
  return value;
}
