import type { SmallProjectPaths } from "../project-core/paths.ts";
import type { AnimationPlan } from "../video-contract/animation-plan.schema.ts";

export type QivanceFrameContracts = {
  schemaVersion: 1;
  smallProjectId: string;
  masterAudioPath: string;
  durationPolicy: "strict";
  totalDurationSec: number;
  frames: Record<string, QivanceFrameContract>;
};

export type QivanceFrameContract = {
  graphNodeId: string;
  sceneId: string;
  order: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  sectionId: string;
  strictDuration: true;
  beatRange?: [number, number];
  wordTimingRange?: [number, number];
  captionMode: string;
  visualIntensity: number;
  allowedHtmlPath: string;
};

export function buildFrameContracts(input: {
  plan: AnimationPlan;
  paths: SmallProjectPaths;
}): QivanceFrameContracts {
  const scenes = [...input.plan.scenes].sort((a, b) => a.order - b.order);
  return {
    schemaVersion: 1,
    smallProjectId: input.plan.smallProjectId,
    masterAudioPath: "audio/master/active_music_take.wav",
    durationPolicy: "strict",
    totalDurationSec: round(scenes.reduce((sum, scene) => sum + scene.durationSec, 0)),
    frames: Object.fromEntries(
      scenes.map((scene, index) => [
        scene.id,
        {
          graphNodeId: scene.id,
          sceneId: scene.id,
          order: scene.order,
          startSec: scene.startSec,
          endSec: scene.endSec,
          durationSec: scene.durationSec,
          sectionId: scene.sectionId,
          strictDuration: true,
          ...(scene.beatSync.preferredBeatRange ? { beatRange: scene.beatSync.preferredBeatRange } : {}),
          captionMode: scene.captionMode,
          visualIntensity: scene.beatSync.intensity,
          allowedHtmlPath: `frames/${String(index + 1).padStart(2, "0")}-${sanitizeFrameId(scene.id)}.html`,
        },
      ]),
    ),
  };
}

function sanitizeFrameId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
