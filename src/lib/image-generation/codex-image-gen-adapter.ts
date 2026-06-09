import type { ImageGenerationAdapter, ImageGenerationRequest, ImageGenerationResult } from "./types.ts";

export const codexImageGenAdapter: ImageGenerationAdapter = {
  id: "codex_image_gen",
  async generateImageCandidates(_request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    throw new Error("Codex image_gen adapter requires a configured invocation before full E2E execution");
  },
};
