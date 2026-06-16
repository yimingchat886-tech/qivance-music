import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { sha256File } from "../fs-utils.ts";
import type { ImageGenerationRequest, ImageGenerationResult } from "./types.ts";

export async function readCachedImageGenerationResult(
  request: ImageGenerationRequest,
): Promise<ImageGenerationResult | null> {
  const candidates: ImageGenerationResult["candidates"] = [];

  for (let index = 0; index < request.variants; index += 1) {
    const candidatePath = path.join(path.resolve(request.outputDir), `${request.requestId}_v${index + 1}.png`);
    try {
      const fileStat = await stat(candidatePath);
      if (!fileStat.isFile()) return null;
    } catch {
      return null;
    }

    const dimensions = await readPngDimensions(candidatePath);
    candidates.push({
      candidateId: `${request.requestId}_v${index + 1}`,
      path: candidatePath,
      sha256: await sha256File(candidatePath),
      width: dimensions.width,
      height: dimensions.height,
      provenance: {
        mode: "cached_e2e_generated_background",
        outputDir: path.resolve(request.outputDir),
      },
    });
  }

  return {
    requestId: request.requestId,
    adapterId: "codex_image_gen",
    status: "succeeded",
    candidates,
    diagnostics: ["reused existing generated background PNGs from outputDir"],
  };
}

async function readPngDimensions(filePath: string): Promise<{ width: number; height: number }> {
  const bytes = await readFile(filePath);
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || bytes.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error(`cached image generation candidate is not a readable PNG: ${filePath}`);
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}
