import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  recommendImageGenerationSchedule,
  targetSizeForAspectRatio,
  validateImageGenerationSchedule,
  writeRecommendedImageGenerationSchedule,
} from "../src/lib/image-generation/image-schedule.ts";

test("recommends schedule items from an existing V2 section map", async () => {
  const sectionMap = JSON.parse(await readFile("projects/media_e2e_v2_portrait_9x16/timing/section_map.json", "utf8"));
  const schedule = recommendImageGenerationSchedule({
    smallProjectId: "media_e2e_v2_portrait_9x16",
    sectionMap,
    sourceSectionMapSha256: "section-map-hash",
    aspectRatio: "9:16",
    generatedAt: "2026-06-12T00:00:00.000Z",
  });

  assert.equal(schedule.schema_version, 1);
  assert.equal(schedule.status, "draft");
  assert.equal(schedule.items.length, 3);
  assert.deepEqual(schedule.items.map((item) => item.scene_id), ["sec_001_hook", "sec_002_build", "sec_003_outro"]);
  assert.deepEqual(schedule.items[0]?.target_size, { width: 1080, height: 1920 });
  assert.equal(schedule.items[0]?.status, "prompt_pending");
  assert.equal(schedule.items[0]?.skip, false);

  const validation = validateImageGenerationSchedule({
    schedule,
    sectionMap,
    smallProjectId: "media_e2e_v2_portrait_9x16",
  });
  assert.equal(validation.ok, true, validation.issues.join("\n"));
});

test("writes the recommended schedule to data/storyboard", async () => {
  const projectRoot = await mkdtemp(path.join("/tmp", "qivance-image-schedule-"));
  await mkdir(path.join(projectRoot, "data", "storyboard"), { recursive: true });
  await writeJson(path.join(projectRoot, "data", "storyboard", "section_map.json"), sectionMapFixture());

  const result = await writeRecommendedImageGenerationSchedule({
    projectRoot,
    smallProjectId: "schedule_demo",
    aspectRatio: "16:9",
    generatedAt: "2026-06-12T00:00:00.000Z",
  });

  assert.equal(result.path, "data/storyboard/image_generation_schedule.json");
  assert.equal(result.schedule.items.length, 2);
  assert.deepEqual(result.schedule.items[0]?.target_size, { width: 1920, height: 1080 });
  const written = JSON.parse(await readFile(path.join(projectRoot, result.path), "utf8"));
  assert.equal(written.small_project_id, "schedule_demo");
  assert.match(written.source_section_map_sha256, /^[a-f0-9]{64}$/);
});

test("validates a user-edited confirmed schedule", () => {
  const sectionMap = sectionMapFixture();
  const schedule = recommendImageGenerationSchedule({
    smallProjectId: "schedule_demo",
    sectionMap,
    sourceSectionMapSha256: "section-map-hash",
    aspectRatio: "1:1",
    generatedAt: "2026-06-12T00:00:00.000Z",
  });
  schedule.status = "confirmed";
  schedule.items[1] = {
    ...schedule.items[1]!,
    image_id: "img_scene_002_custom",
    start_sec: 4,
    end_sec: 8,
    status: "skipped",
    skip: true,
    requires_prompt: false,
    requires_generation: false,
  };
  schedule.manual_overrides.push({
    field: "items[1].skip",
    reason: "manual test edit",
  });

  const validation = validateImageGenerationSchedule({ schedule, sectionMap, smallProjectId: "schedule_demo" });

  assert.equal(validation.ok, true, validation.issues.join("\n"));
});

test("rejects missing scenes and invalid time ranges with clear diagnostics", () => {
  const sectionMap = sectionMapFixture();
  const schedule = recommendImageGenerationSchedule({
    smallProjectId: "schedule_demo",
    sectionMap,
    sourceSectionMapSha256: "section-map-hash",
  });
  schedule.items[0] = {
    ...schedule.items[0]!,
    scene_id: "scene_missing",
  };
  schedule.items[1] = {
    ...schedule.items[1]!,
    start_sec: 3,
    end_sec: 9,
  };

  const validation = validateImageGenerationSchedule({ schedule, sectionMap, smallProjectId: "schedule_demo" });

  assert.equal(validation.ok, false);
  assert.match(validation.issues.join("\n"), /unknown scene scene_missing/);
  assert.match(validation.issues.join("\n"), /time range must stay inside scene/);
});

test("rejects duplicate ids, target-size mismatch, and skipped items requiring work", () => {
  const sectionMap = sectionMapFixture();
  const schedule = recommendImageGenerationSchedule({
    smallProjectId: "schedule_demo",
    sectionMap,
    sourceSectionMapSha256: "section-map-hash",
  });
  schedule.items[1] = {
    ...schedule.items[1]!,
    image_id: schedule.items[0]!.image_id,
    aspect_ratio: "16:9",
    target_size: targetSizeForAspectRatio("9:16"),
    status: "prompt_pending",
    skip: true,
    requires_prompt: true,
    requires_generation: true,
  };

  const validation = validateImageGenerationSchedule({ schedule, sectionMap, smallProjectId: "schedule_demo" });
  const issues = validation.issues.join("\n");

  assert.equal(validation.ok, false);
  assert.match(issues, /duplicates/);
  assert.match(issues, /target_size must match aspect_ratio 16:9/);
  assert.match(issues, /status must be skipped when skip is true/);
  assert.match(issues, /cannot require a prompt/);
  assert.match(issues, /cannot require generation/);
});

function sectionMapFixture() {
  return {
    schema_version: 1,
    duration_sec: 8,
    sections: [
      {
        section_id: "sec_001",
        scene_id: "scene_001_hook",
        section_ids: ["sec_001"],
        start_sec: 0,
        end_sec: 4,
        duration_sec: 4,
        visual_change_density: 0.2,
      },
      {
        section_id: "sec_002",
        scene_id: "scene_002_build",
        section_ids: ["sec_002"],
        start_sec: 4,
        end_sec: 8,
        duration_sec: 4,
      },
    ],
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
