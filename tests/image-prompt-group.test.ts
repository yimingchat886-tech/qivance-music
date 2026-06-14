import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { recommendImageGenerationSchedule, type ImageGenerationSchedule } from "../src/lib/image-generation/image-schedule.ts";
import {
  buildConfirmedAdapterPrompts,
  changeImagePromptGroupStyle,
  confirmImagePromptGroup,
  createImagePromptGroup,
  validateImagePromptGroup,
  writeImagePromptGroup,
} from "../src/lib/image-generation/image-prompt-group.ts";

test("creates a prompt group for non-skipped schedule items", () => {
  const schedule = scheduleFixture();
  schedule.items[1] = { ...schedule.items[1]!, skip: true, status: "skipped" };

  const promptGroup = createImagePromptGroup({
    smallProjectId: "prompt_demo",
    schedule,
    styleId: "high_contrast_cyber_classroom",
    scenePrompts: {
      scene_001_hook: "RAG knowledge graph behind a rapper teacher, no text",
    },
  });

  assert.equal(promptGroup.schema_version, 1);
  assert.equal(promptGroup.small_project_id, "prompt_demo");
  assert.equal(promptGroup.style.style_id, "high_contrast_cyber_classroom");
  assert.equal(promptGroup.status, "draft");
  assert.equal(promptGroup.provenance.llm_assisted, false);
  assert.deepEqual(promptGroup.items.map((item) => item.image_id), [schedule.items[0]!.image_id]);
  assert.equal(promptGroup.items[0]?.manual_override, true);
  assert.match(promptGroup.items[0]?.final_prompt ?? "", /high contrast cyber classroom/);

  const validation = validateImagePromptGroup({ promptGroup, schedule });
  assert.equal(validation.ok, true, validation.issues.join("\n"));
});

test("confirmation enables adapter prompts from confirmed final prompt text only", () => {
  const schedule = scheduleFixture();
  const draft = createImagePromptGroup({
    smallProjectId: "prompt_demo",
    schedule,
    styleId: "kinetic_stage_lights",
  });

  assert.throws(() => buildConfirmedAdapterPrompts({ promptGroup: draft }), /must be confirmed/);
  const confirmed = confirmImagePromptGroup(draft);
  const validation = validateImagePromptGroup({ promptGroup: confirmed, schedule });
  const adapterPrompts = buildConfirmedAdapterPrompts({ promptGroup: confirmed });

  assert.equal(validation.ok, true, validation.issues.join("\n"));
  assert.equal(confirmed.status, "confirmed");
  assert.ok(confirmed.items.every((item) => item.confirmed));
  assert.equal(adapterPrompts.length, schedule.items.length);
  assert.equal(adapterPrompts[0]?.prompt, confirmed.items[0]?.final_prompt);
});

test("changing style marks prompts as requiring reconfirmation", () => {
  const schedule = scheduleFixture();
  const confirmed = confirmImagePromptGroup(createImagePromptGroup({
    smallProjectId: "prompt_demo",
    schedule,
    styleId: "high_contrast_cyber_classroom",
  }));

  const changed = changeImagePromptGroupStyle({
    promptGroup: confirmed,
    styleId: "editorial_music_documentary",
  });

  assert.equal(changed.status, "confirmation_required");
  assert.equal(changed.style.style_id, "editorial_music_documentary");
  assert.ok(changed.items.every((item) => !item.confirmed));
  assert.match(changed.items[0]?.final_prompt ?? "", /editorial music documentary/);
  assert.throws(() => buildConfirmedAdapterPrompts({ promptGroup: changed }), /must be confirmed/);
});

test("validates missing prompts, skipped references, and llm-assisted provenance", () => {
  const schedule = scheduleFixture();
  schedule.items[1] = { ...schedule.items[1]!, skip: true, status: "skipped" };
  const promptGroup = createImagePromptGroup({
    smallProjectId: "prompt_demo",
    schedule,
    styleId: "high_contrast_cyber_classroom",
  });
  const invalidPromptGroup = structuredClone(promptGroup) as {
    provenance: Record<string, unknown>;
    items: Array<Record<string, unknown>>;
  };
  invalidPromptGroup.provenance.llm_assisted = true;
  invalidPromptGroup.items.push({
    ...invalidPromptGroup.items[0],
    image_id: schedule.items[1]!.image_id,
    scene_id: schedule.items[1]!.scene_id,
  });
  invalidPromptGroup.items[0]!.scene_prompt = "";
  invalidPromptGroup.items[0]!.final_prompt = "manual mismatched prompt";

  const validation = validateImagePromptGroup({ promptGroup: invalidPromptGroup, schedule });
  const issues = validation.issues.join("\n");

  assert.equal(validation.ok, false);
  assert.match(issues, /llm_assisted must be false/);
  assert.match(issues, /scene_prompt is required/);
  assert.match(issues, /references a skipped schedule item/);
});

test("writes prompt group to data/storyboard", async () => {
  const projectRoot = await mkdtemp(path.join("/tmp", "qivance-image-prompt-group-"));
  const schedule = scheduleFixture();
  const promptGroup = createImagePromptGroup({
    smallProjectId: "prompt_demo",
    schedule,
    styleId: "high_contrast_cyber_classroom",
  });

  const result = await writeImagePromptGroup({ projectRoot, promptGroup });
  const written = JSON.parse(await readFile(path.join(projectRoot, result.path), "utf8"));

  assert.equal(result.path, "data/storyboard/image_prompt_group.json");
  assert.equal(written.small_project_id, "prompt_demo");
  assert.equal(written.provenance.llm_assisted, false);
});

function scheduleFixture(): ImageGenerationSchedule {
  return recommendImageGenerationSchedule({
    smallProjectId: "prompt_demo",
    sectionMap: {
      schema_version: 1,
      duration_sec: 8,
      sections: [
        {
          section_id: "sec_001",
          scene_id: "scene_001_hook",
          start_sec: 0,
          end_sec: 4,
        },
        {
          section_id: "sec_002",
          scene_id: "scene_002_build",
          start_sec: 4,
          end_sec: 8,
        },
      ],
    },
    sourceSectionMapSha256: "section-map-hash",
    generatedAt: "2026-06-12T00:00:00.000Z",
  });
}
