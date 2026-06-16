export type ImageGenerationRequest = {
  requestId: string;
  sceneId: string;
  assetRole: "background";
  prompt: string;
  referenceAssetIds: string[];
  aspectRatio: "9:16" | "16:9" | "1:1";
  targetSize: { width: number; height: number };
  variants: number;
  outputDir: string;
};

export type ImageGenerationResult = {
  requestId: string;
  adapterId: string;
  status: "succeeded" | "failed";
  candidates: Array<{
    candidateId: string;
    path: string;
    sha256: string;
    width: number;
    height: number;
    provenance: Record<string, unknown>;
  }>;
  diagnostics?: string[];
};

export type ImageGenerationAdapter = {
  id: string;
  generateImageCandidates(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
};
