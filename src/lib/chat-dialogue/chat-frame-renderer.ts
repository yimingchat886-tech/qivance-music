import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { sha256File } from "../fs-utils.ts";
import type { ChatFrameContracts } from "./chat-frame-contracts.ts";

const execFileAsync = promisify(execFile);

export type ChatFrameRenderEvidence = {
  frame_id: string;
  html_path: string;
  screenshot_path: string;
  duration_sec: number;
  screenshot_sha256: string;
};

export type RenderChatFramesToVisualInput = {
  projectRoot: string;
  frameContracts: ChatFrameContracts;
  outputPath: string;
  renderRoot?: string;
  chromeExecutable?: string;
  width?: number;
  height?: number;
  fps?: number;
};

export async function renderChatFramesToVisual(input: RenderChatFramesToVisualInput): Promise<{
  visual_path: string;
  frame_renders: ChatFrameRenderEvidence[];
}> {
  const width = input.width ?? 1080;
  const height = input.height ?? 1920;
  const fps = input.fps ?? 30;
  const chromeExecutable = input.chromeExecutable ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "google-chrome";
  const renderRoot = input.renderRoot ?? path.join(input.projectRoot, "data/chains/chat_dialogue_mv/render_frames");
  await mkdir(renderRoot, { recursive: true });
  await mkdir(path.dirname(input.outputPath), { recursive: true });

  const frameRenders: ChatFrameRenderEvidence[] = [];
  for (const frame of input.frameContracts.frames) {
    const htmlPath = path.join(input.projectRoot, frame.html_path);
    const screenshotPath = path.join(renderRoot, `${frame.frame_id}.png`);
    await execFileAsync(chromeExecutable, chromeScreenshotArgs({ htmlPath, screenshotPath, width, height }), { maxBuffer: 10 * 1024 * 1024 });
    frameRenders.push({
      frame_id: frame.frame_id,
      html_path: frame.html_path,
      screenshot_path: path.relative(input.projectRoot, screenshotPath),
      duration_sec: frame.duration_sec,
      screenshot_sha256: await sha256File(screenshotPath),
    });
  }

  const concatPath = path.join(renderRoot, "frames.concat.txt");
  await writeFile(concatPath, buildFrameConcatList(frameRenders.map((frame) => ({
    screenshotPath: path.join(input.projectRoot, frame.screenshot_path),
    durationSec: frame.duration_sec,
  }))), "utf8");
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-vf",
    `fps=${fps},format=yuv420p`,
    "-movflags",
    "+faststart",
    input.outputPath,
  ], { maxBuffer: 20 * 1024 * 1024 });

  return {
    visual_path: path.relative(input.projectRoot, input.outputPath),
    frame_renders: frameRenders,
  };
}

export function chromeScreenshotArgs(input: {
  htmlPath: string;
  screenshotPath: string;
  width: number;
  height: number;
}): string[] {
  return [
    "--headless=new",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--hide-scrollbars",
    "--run-all-compositor-stages-before-draw",
    "--virtual-time-budget=1000",
    `--window-size=${input.width},${input.height}`,
    `--screenshot=${input.screenshotPath}`,
    pathToFileURL(input.htmlPath).href,
  ];
}

export function buildFrameConcatList(frames: Array<{ screenshotPath: string; durationSec: number }>): string {
  if (frames.length === 0) throw new Error("at least one frame screenshot is required");
  const lines: string[] = [];
  for (const frame of frames) {
    if (!Number.isFinite(frame.durationSec) || frame.durationSec <= 0) throw new Error("frame duration must be positive");
    lines.push(`file '${escapeConcatPath(frame.screenshotPath)}'`);
    lines.push(`duration ${frame.durationSec.toFixed(3)}`);
  }
  lines.push(`file '${escapeConcatPath(frames.at(-1)!.screenshotPath)}'`);
  return `${lines.join("\n")}\n`;
}

function escapeConcatPath(filePath: string): string {
  return filePath.replaceAll("'", "'\\''");
}
