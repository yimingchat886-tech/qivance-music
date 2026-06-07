import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type MediaProbe = {
  durationSec: number;
  hasVideoStream: boolean;
  hasAudioStream: boolean;
  video?: {
    width: number;
    height: number;
    fps: number;
  };
  audio?: {
    durationSec: number | null;
  };
};

export async function ffprobe(filePath: string): Promise<MediaProbe> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,width,height,r_frame_rate,duration",
    "-of",
    "json",
    filePath,
  ]);
  return parseFfprobeJson(stdout);
}

export function parseFfprobeJson(raw: string): MediaProbe {
  const parsed = JSON.parse(raw) as {
    format?: { duration?: string | number };
    streams?: Array<Record<string, unknown>>;
  };
  const streams = parsed.streams ?? [];
  const videoStream = streams.find((stream) => stream.codec_type === "video");
  const audioStream = streams.find((stream) => stream.codec_type === "audio");
  return {
    durationSec: round(Number(parsed.format?.duration ?? 0)),
    hasVideoStream: Boolean(videoStream),
    hasAudioStream: Boolean(audioStream),
    ...(videoStream ? {
      video: {
        width: Number(videoStream.width ?? 0),
        height: Number(videoStream.height ?? 0),
        fps: parseFps(String(videoStream.r_frame_rate ?? "0/1")),
      },
    } : {}),
    ...(audioStream ? {
      audio: {
        durationSec: audioStream.duration === undefined ? null : round(Number(audioStream.duration)),
      },
    } : {}),
  };
}

function parseFps(value: string): number {
  const [num, den] = value.split("/").map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  return round(num / den);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
