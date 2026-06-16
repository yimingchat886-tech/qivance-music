import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLockedImageAssets, validateImageAssetReviewDecisionFile } from "../src/lib/image-generation/image-assets.ts";

test("writes only locked image candidates into image assets", () => {
  const manifest = buildLockedImageAssets({
    smallProjectId: "media_e2e_v2_portrait_9x16",
    decisions: [
      {
        candidateId: "cand_001",
        sceneId: "scene_001_hook",
        role: "background",
        path: "assets/images/generated/bg.png",
        sha256: "abc",
        prompt: "no text",
        status: "locked",
      },
      {
        candidateId: "cand_002",
        sceneId: "scene_001_hook",
        role: "background",
        path: "assets/images/generated/reject.png",
        sha256: "def",
        prompt: "no text",
        status: "rejected",
      },
    ],
  });

  assert.equal(manifest.assets.length, 1);
  assert.equal(manifest.assets[0]?.asset_id, "cand_001");
});

test("validates file-based image review decisions", () => {
  const result = validateImageAssetReviewDecisionFile({
    smallProjectId: "media_e2e_v2_portrait_9x16",
    candidateIds: ["cand_001", "cand_002"],
    review: {
      schema_version: 1,
      small_project_id: "media_e2e_v2_portrait_9x16",
      decisions: [
        { candidate_id: "cand_001", status: "locked", reason: "best fit", decided_by: "reviewer" },
        { candidate_id: "cand_002", status: "rejected", reason: "too busy" },
      ],
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.decisions.map((decision) => decision.status), ["locked", "rejected"]);
  assert.equal(result.decisions[0]?.decidedBy, "reviewer");
});

test("rejects review decisions for unknown generated candidates", () => {
  const result = validateImageAssetReviewDecisionFile({
    smallProjectId: "media_e2e_v2_portrait_9x16",
    candidateIds: ["cand_001"],
    review: {
      schema_version: 1,
      small_project_id: "media_e2e_v2_portrait_9x16",
      decisions: [{ candidate_id: "cand_999", status: "locked" }],
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /unknown candidate cand_999/);
});
