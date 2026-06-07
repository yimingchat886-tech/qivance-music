import type { MediaProbe } from "./ffprobe.ts";

export type RenderManifest = {
  schemaVersion: 1;
  smallProjectId: string;
  videoBackend: "html-video";
  engine: "qivance-hyperframes-strict";
  durationPolicy: "strict";
  visualMp4Path: string;
  masterAudioPath: string;
  finalMp4Path: string;
  contentGraphPath: string;
  frameContractsPath: string;
  qa: {
    hasVideoStream: boolean;
    hasAudioStream: boolean;
    videoDurationSec: number;
    audioDurationSec: number | null;
    durationDriftSec: number;
    resolutionOk: boolean;
    fpsOk: boolean;
  };
};

export function buildRenderManifest(input: {
  smallProjectId: string;
  contentGraphPath: string;
  frameContractsPath: string;
  visualMp4Path: string;
  masterAudioPath: string;
  finalMp4Path: string;
  expected: {
    durationSec: number;
    fps: number;
    resolution: { width: number; height: number };
  };
  finalProbe: MediaProbe;
}): RenderManifest {
  const video = input.finalProbe.video;
  return {
    schemaVersion: 1,
    smallProjectId: input.smallProjectId,
    videoBackend: "html-video",
    engine: "qivance-hyperframes-strict",
    durationPolicy: "strict",
    visualMp4Path: input.visualMp4Path,
    masterAudioPath: input.masterAudioPath,
    finalMp4Path: input.finalMp4Path,
    contentGraphPath: input.contentGraphPath,
    frameContractsPath: input.frameContractsPath,
    qa: {
      hasVideoStream: input.finalProbe.hasVideoStream,
      hasAudioStream: input.finalProbe.hasAudioStream,
      videoDurationSec: input.finalProbe.durationSec,
      audioDurationSec: input.finalProbe.audio?.durationSec ?? null,
      durationDriftSec: round(Math.abs(input.finalProbe.durationSec - input.expected.durationSec)),
      resolutionOk: Boolean(video && video.width === input.expected.resolution.width && video.height === input.expected.resolution.height),
      fpsOk: Boolean(video && Math.abs(video.fps - input.expected.fps) <= 0.01),
    },
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
