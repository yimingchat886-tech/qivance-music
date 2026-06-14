import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  generateImageCandidatesViaParentWrapper,
  type ParentImageGenRunner,
} from "../src/lib/image-generation/codex-exec-image-gen-parent-wrapper.ts";
import type { ImageGenerationRequest } from "../src/lib/image-generation/types.ts";

test("parent wrapper discovers generated images and emits canonical result", async () => {
  const root = await mkdtemp(path.join("/tmp", "qivance-parent-wrapper-"));
  const generatedRoot = path.join(root, "codex-home", "generated_images");
  const sessionDir = path.join(generatedRoot, "session-001");
  const outputDir = path.join(root, "generated-backgrounds");
  await mkdir(sessionDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  let prompt = "";
  let args: string[] = [];
  const runner: ParentImageGenRunner = async (input) => {
    prompt = input.stdin;
    args = input.args;
    await writeFile(path.join(sessionDir, "ig_test.png"), pngHeader(1254, 1254));
    return { stdout: "IMAGE_GEN_DONE", stderr: "", exitCode: 0 };
  };

  const result = await generateImageCandidatesViaParentWrapper(request(outputDir), {
    cwd: root,
    env: { ...process.env, QIVANCE_CODEX_GENERATED_IMAGES_DIR: generatedRoot },
    codexCommand: "/usr/local/bin/codex",
    runner,
    jobId: "test-job",
  });

  const copiedPath = path.join(outputDir, "img_req_001_v1.png");
  assert.equal(result.requestId, "img_req_001");
  assert.equal(result.adapterId, "codex_image_gen");
  assert.equal(result.status, "succeeded");
  assert.equal(result.candidates[0]?.path, copiedPath);
  assert.equal(result.candidates[0]?.sha256, sha256(await readFile(copiedPath)));
  assert.equal(result.candidates[0]?.width, 1254);
  assert.equal(result.candidates[0]?.height, 1254);
  assert.equal(result.candidates[0]?.provenance.sourcePath, path.join(sessionDir, "ig_test.png"));
  assert.ok(args.includes("--output-last-message"));
  assert.ok(args.includes("--ignore-user-config"));
  assert.match(prompt, /Only call image generation/);
  assert.doesNotMatch(prompt, /copy or move/i);
});

test("parent wrapper requires enough generated candidates", async () => {
  const root = await mkdtemp(path.join("/tmp", "qivance-parent-wrapper-missing-"));
  const generatedRoot = path.join(root, "codex-home", "generated_images");
  const outputDir = path.join(root, "generated-backgrounds");
  await mkdir(generatedRoot, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const runner: ParentImageGenRunner = async () => ({ stdout: "done", stderr: "", exitCode: 0 });

  await assert.rejects(
    () => generateImageCandidatesViaParentWrapper(request(outputDir), {
      cwd: root,
      env: { ...process.env, QIVANCE_CODEX_GENERATED_IMAGES_DIR: generatedRoot },
      runner,
      jobId: "test-job",
    }),
    /produced 0 PNG candidate/,
  );
});

test("parent wrapper reports codex exec timeout", async () => {
  const root = await mkdtemp(path.join("/tmp", "qivance-parent-wrapper-timeout-"));
  const generatedRoot = path.join(root, "codex-home", "generated_images");
  const outputDir = path.join(root, "generated-backgrounds");
  const commandPath = path.join(root, "never-exits.js");
  await mkdir(generatedRoot, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await writeFile(commandPath, "#!/usr/bin/env node\nsetTimeout(() => {}, 60_000);\n", "utf8");
  await chmod(commandPath, 0o755);

  await assert.rejects(
    () => generateImageCandidatesViaParentWrapper(request(outputDir), {
      cwd: root,
      env: { ...process.env, QIVANCE_CODEX_GENERATED_IMAGES_DIR: generatedRoot },
      codexCommand: commandPath,
      timeoutMs: 50,
      jobId: "test-job",
    }),
    /exit code 124/,
  );
});

function request(outputDir: string): ImageGenerationRequest {
  return {
    requestId: "img_req_001",
    sceneId: "scene_001",
    assetRole: "background",
    prompt: "city lights, no text",
    referenceAssetIds: [],
    aspectRatio: "1:1",
    targetSize: { width: 1024, height: 1024 },
    variants: 1,
    outputDir,
  };
}

function pngHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
