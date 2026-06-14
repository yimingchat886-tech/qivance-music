import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  confirmImagePromptGroup,
  createImagePromptGroup,
  type ImagePromptGroup,
} from "../src/lib/image-generation/image-prompt-group.ts";
import {
  recommendImageGenerationSchedule,
  type ImageGenerationSchedule,
} from "../src/lib/image-generation/image-schedule.ts";
import {
  applyImageReviewAction,
  buildRegenerationImageRequest,
  createImageReviewDecisionFile,
  readImageReviewDecisionFile,
  validateImageReviewDecisionFile,
  writeImageReviewDecisionFile,
  writeLockedImageAssetsFromReview,
} from "../src/lib/image-generation/image-review-decisions.ts";
import type { ImageGenerationResult } from "../src/lib/image-generation/types.ts";

test("applies review actions as one active decision per image and persists them", async () => {
  const fixture = await reviewFixture();
  const imageId = fixture.schedule.items[0]!.image_id;
  const candidate = fixture.imageResults[0]!.candidates[0]!;
  const prompt = fixture.promptGroup.items[0]!.final_prompt;
  const review = createImageReviewDecisionFile({ smallProjectId: fixture.smallProjectId });
  const locked = applyImageReviewAction({
    review,
    action: "lock",
    imageId,
    candidateId: candidate.candidateId,
    candidatePath: fixture.candidatePaths[0]!,
    prompt,
    sha256: candidate.sha256,
    width: candidate.width,
    height: candidate.height,
    provenance: candidate.provenance,
    decidedAt: "2026-06-12T00:00:00.000Z",
    decidedBy: "reviewer",
  });
  const rejected = applyImageReviewAction({
    review: locked,
    action: "reject",
    imageId,
    candidateId: candidate.candidateId,
    reason: "too busy",
    decidedAt: "2026-06-12T00:01:00.000Z",
    decidedBy: "reviewer",
  });

  await writeImageReviewDecisionFile({ projectRoot: fixture.projectRoot, review: rejected });
  const readBack = await readImageReviewDecisionFile(fixture.projectRoot, fixture.smallProjectId);

  assert.equal(readBack.decisions.length, 1);
  assert.equal(readBack.decisions[0]?.action, "reject");
  assert.equal(readBack.decisions[0]?.reason, "too busy");
});

test("writes only locked reviewed candidates into image_assets.json", async () => {
  const fixture = await reviewFixture();
  const lockImageId = fixture.schedule.items[0]!.image_id;
  const rejectImageId = fixture.schedule.items[1]!.image_id;
  const lockCandidate = fixture.imageResults[0]!.candidates[0]!;
  const rejectCandidate = fixture.imageResults[1]!.candidates[0]!;
  let review = createImageReviewDecisionFile({ smallProjectId: fixture.smallProjectId });
  review = applyImageReviewAction({
    review,
    action: "lock",
    imageId: lockImageId,
    candidateId: lockCandidate.candidateId,
    candidatePath: fixture.candidatePaths[0]!,
    prompt: fixture.promptGroup.items[0]!.final_prompt,
    sha256: lockCandidate.sha256,
    width: lockCandidate.width,
    height: lockCandidate.height,
    provenance: lockCandidate.provenance,
    decidedAt: "2026-06-12T00:00:00.000Z",
    decidedBy: "reviewer",
  });
  review = applyImageReviewAction({
    review,
    action: "reject",
    imageId: rejectImageId,
    candidateId: rejectCandidate.candidateId,
    reason: "not useful",
    decidedAt: "2026-06-12T00:01:00.000Z",
    decidedBy: "reviewer",
  });

  const result = await writeLockedImageAssetsFromReview({
    projectRoot: fixture.projectRoot,
    smallProjectId: fixture.smallProjectId,
    review,
    schedule: fixture.schedule,
    promptGroup: fixture.promptGroup,
    imageResults: fixture.imageResults,
  });
  const written = JSON.parse(await readFile(path.join(fixture.projectRoot, result.path), "utf8"));

  assert.equal(result.path, "data/storyboard/image_assets.json");
  assert.equal(result.imageAssets.assets.length, 1);
  assert.equal(result.imageAssets.assets[0]?.asset_id, lockCandidate.candidateId);
  assert.equal(written.assets[0]?.path, fixture.candidatePaths[0]);
});

test("rejects locked candidates without project-local file, provenance, or confirmed prompt", async () => {
  const fixture = await reviewFixture();
  const imageId = fixture.schedule.items[0]!.image_id;
  const candidate = fixture.imageResults[0]!.candidates[0]!;
  const unconfirmedPromptGroup: ImagePromptGroup = {
    ...fixture.promptGroup,
    status: "confirmation_required",
    items: fixture.promptGroup.items.map((item) => ({ ...item, confirmed: false })),
  };
  const review = applyImageReviewAction({
    review: createImageReviewDecisionFile({ smallProjectId: fixture.smallProjectId }),
    action: "lock",
    imageId,
    candidateId: candidate.candidateId,
    candidatePath: "assets/images/generated/missing.png",
    prompt: fixture.promptGroup.items[0]!.final_prompt,
    sha256: candidate.sha256,
    width: candidate.width,
    height: candidate.height,
    decidedAt: "2026-06-12T00:00:00.000Z",
    decidedBy: "reviewer",
  });

  const validation = validateImageReviewDecisionFile({
    review,
    smallProjectId: fixture.smallProjectId,
    schedule: fixture.schedule,
    promptGroup: unconfirmedPromptGroup,
    imageResults: fixture.imageResults,
    projectRoot: fixture.projectRoot,
  });
  const issues = validation.issues.join("\n");

  assert.equal(validation.ok, false);
  assert.match(issues, /file must exist under the project root/);
  assert.match(issues, /confirmed prompt text/);
  assert.match(issues, /provenance is required/);
});

test("requires skip decisions to be reflected in the schedule", async () => {
  const fixture = await reviewFixture();
  const imageId = fixture.schedule.items[0]!.image_id;
  const review = applyImageReviewAction({
    review: createImageReviewDecisionFile({ smallProjectId: fixture.smallProjectId }),
    action: "skip",
    imageId,
    reason: "covered by motion graphics",
    decidedAt: "2026-06-12T00:00:00.000Z",
    decidedBy: "reviewer",
  });

  const invalid = validateImageReviewDecisionFile({
    review,
    smallProjectId: fixture.smallProjectId,
    schedule: fixture.schedule,
    promptGroup: fixture.promptGroup,
    imageResults: fixture.imageResults,
    projectRoot: fixture.projectRoot,
  });
  const skippedSchedule: ImageGenerationSchedule = {
    ...fixture.schedule,
    items: fixture.schedule.items.map((item) =>
      item.image_id === imageId ? { ...item, skip: true, status: "skipped" } : item
    ),
  };
  const valid = validateImageReviewDecisionFile({
    review,
    smallProjectId: fixture.smallProjectId,
    schedule: skippedSchedule,
    promptGroup: fixture.promptGroup,
    imageResults: fixture.imageResults,
    projectRoot: fixture.projectRoot,
  });

  assert.equal(invalid.ok, false);
  assert.match(invalid.issues.join("\n"), /requires the linked schedule item to be skipped/);
  assert.equal(valid.ok, true, valid.issues.join("\n"));
});

test("builds regenerate requests from confirmed prompt text while preserving style", async () => {
  const fixture = await reviewFixture();
  const imageId = fixture.schedule.items[0]!.image_id;
  const promptItem = fixture.promptGroup.items[0]!;
  const request = buildRegenerationImageRequest({
    imageId,
    schedule: fixture.schedule,
    promptGroup: fixture.promptGroup,
    outputDir: path.join(fixture.projectRoot, "assets", "images", "generated"),
    variants: 2,
    promptOverride: "closer classroom performance angle, no text",
  });
  const unconfirmedPromptGroup: ImagePromptGroup = {
    ...fixture.promptGroup,
    status: "confirmation_required",
    items: fixture.promptGroup.items.map((item) => ({ ...item, confirmed: false })),
  };

  assert.equal(request.requestId, `regen_${imageId}`);
  assert.equal(request.sceneId, fixture.schedule.items[0]?.scene_id);
  assert.equal(request.aspectRatio, fixture.schedule.items[0]?.aspect_ratio);
  assert.deepEqual(request.targetSize, fixture.schedule.items[0]?.target_size);
  assert.equal(request.variants, 2);
  assert.match(request.prompt, /high contrast cyber classroom/);
  assert.match(request.prompt, /closer classroom performance angle/);
  assert.match(request.prompt, new RegExp(promptItem.generation_constraints));
  assert.notEqual(request.prompt, "closer classroom performance angle, no text");
  assert.throws(
    () => buildRegenerationImageRequest({
      imageId,
      schedule: fixture.schedule,
      promptGroup: unconfirmedPromptGroup,
      outputDir: "/tmp/out",
    }),
    /confirmed prompt group text/,
  );
});

test("rejects review paths that escape the project root", async () => {
  const fixture = await reviewFixture();
  const imageId = fixture.schedule.items[0]!.image_id;
  const candidate = fixture.imageResults[0]!.candidates[0]!;
  const review = applyImageReviewAction({
    review: createImageReviewDecisionFile({ smallProjectId: fixture.smallProjectId }),
    action: "lock",
    imageId,
    candidateId: candidate.candidateId,
    candidatePath: "../outside.png",
    prompt: fixture.promptGroup.items[0]!.final_prompt,
    sha256: candidate.sha256,
    width: candidate.width,
    height: candidate.height,
    provenance: candidate.provenance,
    decidedAt: "2026-06-12T00:00:00.000Z",
    decidedBy: "reviewer",
  });

  const validation = validateImageReviewDecisionFile({
    review,
    smallProjectId: fixture.smallProjectId,
    schedule: fixture.schedule,
    promptGroup: fixture.promptGroup,
    imageResults: fixture.imageResults,
    projectRoot: fixture.projectRoot,
  });

  assert.equal(validation.ok, false);
  assert.match(validation.issues.join("\n"), /candidate_path must be project-relative/);
});

async function reviewFixture(): Promise<{
  smallProjectId: string;
  projectRoot: string;
  schedule: ImageGenerationSchedule;
  promptGroup: ImagePromptGroup;
  imageResults: ImageGenerationResult[];
  candidatePaths: string[];
}> {
  const smallProjectId = "review_demo";
  const projectRoot = await mkdtemp(path.join("/tmp", "qivance-image-review-"));
  const schedule = recommendImageGenerationSchedule({
    smallProjectId,
    sectionMap: {
      schema_version: 1,
      duration_sec: 8,
      sections: [
        { section_id: "sec_001", scene_id: "scene_001_hook", start_sec: 0, end_sec: 4 },
        { section_id: "sec_002", scene_id: "scene_002_build", start_sec: 4, end_sec: 8 },
      ],
    },
    sourceSectionMapSha256: "section-map-hash",
    generatedAt: "2026-06-12T00:00:00.000Z",
  });
  schedule.status = "confirmed";
  schedule.items = schedule.items.map((item) => ({ ...item, status: "prompt_confirmed" }));
  const promptGroup = confirmImagePromptGroup(createImagePromptGroup({
    smallProjectId,
    schedule,
    styleId: "high_contrast_cyber_classroom",
  }));
  const imageResults: ImageGenerationResult[] = [];
  const candidatePaths: string[] = [];
  for (const item of schedule.items) {
    const relativePath = `assets/images/generated/${item.image_id}_v1.png`;
    const absolutePath = path.join(projectRoot, relativePath);
    const contents = Buffer.from(`candidate:${item.image_id}`);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents);
    candidatePaths.push(relativePath);
    imageResults.push({
      requestId: item.image_id,
      adapterId: "codex_image_gen",
      status: "succeeded",
      candidates: [
        {
          candidateId: `${item.image_id}_v1`,
          path: absolutePath,
          sha256: sha256(contents),
          width: item.target_size.width,
          height: item.target_size.height,
          provenance: { adapter: "test" },
        },
      ],
    });
  }
  return { smallProjectId, projectRoot, schedule, promptGroup, imageResults, candidatePaths };
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
