import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SmallProjectPaths } from "../project-core/paths.ts";

export type HtmlVideoPreviewModel = {
  smallProjectId: string;
  htmlVideoProjectId: string;
  totalDurationSec: number;
  frames: Array<{
    graphNodeId: string;
    order: number;
    durationSec: number;
    htmlPath: string;
    previewUrl: string;
    startSec: number;
    endSec: number;
  }>;
};

type ProjectJson = {
  id: string;
  frames?: Array<{
    graphNodeId: string;
    htmlPath: string;
    durationSec: number;
    order: number;
  }>;
};

type FrameContractsJson = {
  totalDurationSec?: number;
};

export async function loadHtmlVideoPreviewModel(paths: SmallProjectPaths): Promise<HtmlVideoPreviewModel> {
  const project = JSON.parse(await readFile(paths.projectJsonPath, "utf8")) as ProjectJson;
  const contracts = JSON.parse(await readFile(paths.frameContractsPath, "utf8")) as FrameContractsJson;
  let cursor = 0;
  const frames = [...(project.frames ?? [])]
    .sort((a, b) => a.order - b.order)
    .map((frame) => {
      const filename = path.basename(frame.htmlPath);
      const startSec = cursor;
      const endSec = round(startSec + frame.durationSec);
      cursor = endSec;
      return {
        graphNodeId: frame.graphNodeId,
        order: frame.order,
        durationSec: frame.durationSec,
        htmlPath: frame.htmlPath,
        previewUrl: `/preview/${encodeURIComponent(paths.smallProjectId)}/frames/${encodeURIComponent(filename)}`,
        startSec,
        endSec,
      };
    });

  return {
    smallProjectId: paths.smallProjectId,
    htmlVideoProjectId: project.id,
    totalDurationSec: contracts.totalDurationSec ?? round(frames.reduce((sum, frame) => sum + frame.durationSec, 0)),
    frames,
  };
}

export function resolvePreviewFramePath(paths: SmallProjectPaths, filename: string): string {
  const basename = path.basename(filename);
  if (basename !== filename || !/^[a-zA-Z0-9_.-]+\.html$/.test(filename)) {
    throw new Error("Invalid preview frame filename.");
  }
  return path.join(paths.framesDir, basename).replaceAll(path.sep, "/");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
