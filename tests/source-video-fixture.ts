import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MediaProbe } from "../src/lib/export/ffprobe.ts";

export const SOURCE_VIDEO_FIXTURE_PROBE: MediaProbe = {
  durationSec: 24,
  hasVideoStream: true,
  hasAudioStream: true,
  videoStreamCount: 1,
  audioStreamCount: 1,
  video: {
    codecName: "h264",
    width: 1080,
    height: 1920,
    fps: 30,
  },
  audio: {
    codecName: "aac",
    durationSec: 24,
  },
};

export async function writeSourceVideoFixture(input: {
  projectRoot: string;
  relativePath?: string;
}): Promise<{ path: string; absolutePath: string; bytes: Buffer; sha256: string; probe: MediaProbe }> {
  const relativePath = input.relativePath ?? "source_video.mp4";
  const absolutePath = path.join(input.projectRoot, relativePath);
  const bytes = sourceVideoFixtureBytes();
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
  return {
    path: relativePath,
    absolutePath,
    bytes,
    sha256: sha256(bytes),
    probe: SOURCE_VIDEO_FIXTURE_PROBE,
  };
}

function sourceVideoFixtureBytes(): Buffer {
  return Buffer.concat([
    Buffer.from("00000018667479706d703432000000006d70343269736f6d", "hex"),
    Buffer.from("qivance deterministic source mp4 fixture\n", "utf8"),
  ]);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
