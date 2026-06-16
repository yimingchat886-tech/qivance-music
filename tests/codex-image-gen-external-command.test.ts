import test from "node:test";
import assert from "node:assert/strict";
import {
  createExternalCommandImageGenerationAdapter,
  type ExternalImageGenRunner,
} from "../src/lib/image-generation/codex-image-gen-adapter.ts";

test("Codex image_gen adapter sends request JSON to external command", async () => {
  let stdin = "";
  const runner: ExternalImageGenRunner = async (input) => {
    stdin = input.stdin;
    return {
      stdout: JSON.stringify({
        requestId: "img_req_001",
        adapterId: "codex_image_gen",
        status: "succeeded",
        candidates: [
          {
            candidateId: "img_req_001_v1",
            path: "images/img_req_001_v1.png",
            sha256: "abc",
            width: 1080,
            height: 1920,
            provenance: { command: input.command },
          },
        ],
      }),
      stderr: "",
      exitCode: 0,
    };
  };
  const adapter = createExternalCommandImageGenerationAdapter({
    command: "/usr/local/bin/codex-image-gen",
    runner,
  });

  const result = await adapter.generateImageCandidates({
    requestId: "img_req_001",
    sceneId: "scene_001",
    assetRole: "background",
    prompt: "city lights, no text",
    referenceAssetIds: [],
    aspectRatio: "9:16",
    targetSize: { width: 1080, height: 1920 },
    variants: 1,
    outputDir: "/tmp/images",
  });

  assert.equal(JSON.parse(stdin).requestId, "img_req_001");
  assert.equal(result.status, "succeeded");
  assert.equal(result.candidates[0]?.width, 1080);
});

test("Codex image_gen adapter blocks when no real external command is configured", async () => {
  const adapter = createExternalCommandImageGenerationAdapter({ env: {} });

  await assert.rejects(
    () => adapter.generateImageCandidates({
      requestId: "img_req_001",
      sceneId: "scene_001",
      assetRole: "background",
      prompt: "city lights, no text",
      referenceAssetIds: [],
      aspectRatio: "9:16",
      targetSize: { width: 1080, height: 1920 },
      variants: 1,
      outputDir: "/tmp/images",
    }),
    /QIVANCE_CODEX_IMAGE_GEN_CMD/,
  );
});

