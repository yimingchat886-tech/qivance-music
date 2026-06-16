import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function muxLockedAudio(input: {
  visualMp4Path: string;
  masterAudioPath: string;
  finalMp4Path: string;
}): Promise<void> {
  await mkdir(path.dirname(input.finalMp4Path), { recursive: true });
  await execFileAsync("ffmpeg", buildMuxLockedAudioCommand({
    visualPath: input.visualMp4Path,
    audioPath: input.masterAudioPath,
    outputPath: input.finalMp4Path,
  }));
}

export function buildMuxLockedAudioCommand(input: {
  visualPath: string;
  audioPath: string;
  outputPath: string;
}): string[] {
  return [
    "-y",
    "-i",
    input.visualPath,
    "-i",
    input.audioPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    input.outputPath,
  ];
}
