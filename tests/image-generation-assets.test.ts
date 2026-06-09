import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLockedImageAssets } from "../src/lib/image-generation/image-assets.ts";

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
