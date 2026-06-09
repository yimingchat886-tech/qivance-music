import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateMediaE2EFixtureBundle } from "../src/lib/media-e2e/fixture-contract.ts";

async function writeBaseFixture(root: string, overrides: {
  aspectRatio?: string;
  width?: number;
  height?: number;
  imageGenerationEnabled?: boolean;
} = {}): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "active_music_take.mp3"), "fake-mp3", "utf8");
  await writeFile(path.join(root, "lyrics.md"), "RAG is not magic", "utf8");
  await writeFile(path.join(root, "animation_plan.json"), JSON.stringify({
    schema_version: 1,
    small_project_id: "media_e2e_v2_portrait_9x16",
    aspect_ratio: overrides.aspectRatio ?? "9:16",
    resolution: {
      width: overrides.width ?? 1080,
      height: overrides.height ?? 1920,
    },
    fps: 30,
    duration_sec: 30,
    scenes: [
      {
        scene_id: "scene_001_hook",
        section_ids: ["sec_001_hook"],
        start_sec: 0,
        end_sec: 8,
        image_generation: { enabled: overrides.imageGenerationEnabled ?? true },
      },
      {
        scene_id: "scene_002_body",
        section_ids: ["sec_002_body"],
        start_sec: 8,
        end_sec: 22,
        image_generation: { enabled: false },
      },
      {
        scene_id: "scene_003_outro",
        section_ids: ["sec_003_outro"],
        start_sec: 22,
        end_sec: 30,
        image_generation: { enabled: false },
      },
    ],
  }), "utf8");
  await writeFile(path.join(root, "image_generation_plan.json"), JSON.stringify({
    schema_version: 1,
    small_project_id: "media_e2e_v2_portrait_9x16",
    requests: [
      {
        request_id: "img_req_scene_001",
        scene_id: "scene_001_hook",
        asset_role: "background",
        prompt: "no text",
        reference_asset_ids: [],
        aspect_ratio: overrides.aspectRatio ?? "9:16",
        target_size: {
          width: overrides.width ?? 1080,
          height: overrides.height ?? 1920,
        },
        variants: 2,
      },
    ],
  }), "utf8");
}

test("validates required V2 fixture files and ratio", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "qivance-media-e2e-fixture-valid-"));
  await writeBaseFixture(root);

  const result = await validateMediaE2EFixtureBundle({ bundlePath: root, ratio: "portrait-9x16" });

  assert.equal(result.ok, true);
  assert.equal(result.projectId, "media_e2e_v2_portrait_9x16");
  assert.deepEqual(result.issues, []);
});

test("rejects fixtures without a generated background scene", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "qivance-media-e2e-fixture-invalid-"));
  await writeBaseFixture(root, { imageGenerationEnabled: false });

  const result = await validateMediaE2EFixtureBundle({ bundlePath: root, ratio: "portrait-9x16" });

  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /image_generation.enabled/);
});
