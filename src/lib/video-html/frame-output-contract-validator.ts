import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { QivanceFrameContracts } from "./qivance-frame-contracts.ts";
import { validateFrameHtmlReferences } from "./frame-output-validator.ts";

export type FrameOutputValidationResult = {
  ok: boolean;
  issues: string[];
  frameCount: number;
};

export async function validateFrameOutputs(input: {
  framesDir: string;
  contracts: QivanceFrameContracts;
  allowedLocalImagePaths: string[];
  allowedLocalVideoPaths?: string[];
}): Promise<FrameOutputValidationResult> {
  const issues: string[] = [];
  const contracts = Object.values(input.contracts.frames).sort((a, b) => a.order - b.order);

  for (const contract of contracts) {
    const framePath = path.join(input.framesDir, path.basename(contract.allowedHtmlPath));
    try {
      const fileStat = await stat(framePath);
      if (!fileStat.isFile()) issues.push(`frame is not a file: ${contract.allowedHtmlPath}`);
    } catch {
      issues.push(`missing frame: ${contract.allowedHtmlPath}`);
      continue;
    }

    const html = await readFile(framePath, "utf8");
    const refs = validateFrameHtmlReferences({
      html,
      allowedLocalImagePaths: input.allowedLocalImagePaths,
      allowedLocalVideoPaths: input.allowedLocalVideoPaths,
    });
    issues.push(...refs.issues.map((issue) => `${contract.allowedHtmlPath}: ${issue}`));

    const metadata = extractQivanceFrameMetadata(html);
    if (!metadata) {
      issues.push(`${contract.allowedHtmlPath}: missing window.__QIVANCE_FRAME metadata`);
      continue;
    }
    if (metadata.graphNodeId !== contract.graphNodeId) {
      issues.push(`${contract.allowedHtmlPath}: graphNodeId metadata mismatch`);
    }
    if (metadata.sceneId !== contract.sceneId) {
      issues.push(`${contract.allowedHtmlPath}: sceneId metadata mismatch`);
    }
    if (metadata.durationPolicy !== "strict") {
      issues.push(`${contract.allowedHtmlPath}: durationPolicy metadata must be strict`);
    }
    if (Math.abs(Number(metadata.durationSec) - contract.durationSec) > 0.05) {
      issues.push(`${contract.allowedHtmlPath}: durationSec metadata drift exceeds 50ms`);
    }
  }

  return { ok: issues.length === 0, issues, frameCount: contracts.length };
}

function extractQivanceFrameMetadata(html: string): Record<string, unknown> | null {
  const match = html.match(/window\.__QIVANCE_FRAME\s*=\s*(\{[\s\S]*?\});/);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}
