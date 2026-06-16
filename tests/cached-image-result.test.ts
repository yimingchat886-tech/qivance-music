import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readCachedImageGenerationResult } from "../src/lib/image-generation/cached-image-result.ts";
import type { ImageGenerationRequest } from "../src/lib/image-generation/types.ts";

test("reads cached generated PNG candidates as an ImageGenerationResult", async () => {
  const outputDir = path.join(tmpdir(), `qivance-cached-image-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "img_req_scene_001_v1.png"), pngHeader(1080, 1920));
  await writeFile(path.join(outputDir, "img_req_scene_001_v2.png"), pngHeader(1080, 1920));

  const request: ImageGenerationRequest = {
    requestId: "img_req_scene_001",
    sceneId: "scene_001",
    assetRole: "background",
    prompt: "background, no text",
    referenceAssetIds: [],
    aspectRatio: "9:16",
    targetSize: { width: 1080, height: 1920 },
    variants: 2,
    outputDir,
  };

  const result = await readCachedImageGenerationResult(request);

  assert.equal(result?.status, "succeeded");
  assert.equal(result?.adapterId, "codex_image_gen");
  assert.equal(result?.candidates.length, 2);
  assert.equal(result?.candidates[0]?.width, 1080);
  assert.equal(result?.candidates[0]?.height, 1920);
  assert.equal(result?.candidates[0]?.provenance.mode, "cached_e2e_generated_background");
});

test("returns null when any expected cached variant is missing", async () => {
  const outputDir = path.join(tmpdir(), `qivance-cached-image-missing-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "img_req_scene_001_v1.png"), pngHeader(1024, 1024));

  const result = await readCachedImageGenerationResult({
    requestId: "img_req_scene_001",
    sceneId: "scene_001",
    assetRole: "background",
    prompt: "background, no text",
    referenceAssetIds: [],
    aspectRatio: "1:1",
    targetSize: { width: 1024, height: 1024 },
    variants: 2,
    outputDir,
  });

  assert.equal(result, null);
});

function pngHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
