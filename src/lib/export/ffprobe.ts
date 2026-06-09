import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type MediaProbe = {
  durationSec: number;
  hasVideoStream: boolean;
  hasAudioStream: boolean;
  videoStreamCount: number;
  audioStreamCount: number;
  video?: {
    codecName: string | null;
    width: number;
    height: number;
    fps: number;
  };
  audio?: {
    codecName: string | null;
    durationSec: number | null;
  };
};

export async function ffprobe(filePath: string): Promise<MediaProbe> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,duration",
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
  const videoStreams = streams.filter((stream) => stream.codec_type === "video");
  const audioStreams = streams.filter((stream) => stream.codec_type === "audio");
  const videoStream = videoStreams[0];
  const audioStream = audioStreams[0];
  return {
    durationSec: round(Number(parsed.format?.duration ?? 0)),
    hasVideoStream: Boolean(videoStream),
    hasAudioStream: Boolean(audioStream),
    videoStreamCount: videoStreams.length,
    audioStreamCount: audioStreams.length,
    ...(videoStream ? {
      video: {
        codecName: stringOrNull(videoStream.codec_name),
        width: Number(videoStream.width ?? 0),
        height: Number(videoStream.height ?? 0),
        fps: parseFps(String(videoStream.r_frame_rate ?? "0/1")),
      },
    } : {}),
    ...(audioStream ? {
      audio: {
        codecName: stringOrNull(audioStream.codec_name),
        durationSec: audioStream.duration === undefined ? null : round(Number(audioStream.duration)),
      },
    } : {}),
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseFps(value: string): number {
  const [num, den] = value.split("/").map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  return round(num / den);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
