import { readFile } from "node:fs/promises";
import type { EngineAdapter, RenderContext, RenderInput, RenderOutput } from "@html-video/core";
import hyperframesAdapter from "@html-video/adapter-hyperframes";

export type DurationPolicy = "strict";

export type QivanceRenderOptions = {
  durationPolicy: "strict";
  durationToleranceSec: number;
};

export class StrictDurationViolationError extends Error {
  code = "duration-policy-violation" as const;
  details: {
    framePath: string;
    requestedDurationSec: number;
    detectedAnimationDurationSec: number;
    toleranceSec: number;
  };

  constructor(details: {
    framePath: string;
    requestedDurationSec: number;
    detectedAnimationDurationSec: number;
    toleranceSec: number;
  }) {
    super(
      `Frame animation duration ${details.detectedAnimationDurationSec}s exceeds requested ${details.requestedDurationSec}s.`,
    );
    this.details = details;
  }
}

export const qivanceHyperframesStrictAdapter: EngineAdapter = {
  ...hyperframesAdapter,
  id: "qivance-hyperframes-strict",
  name: "Qivance Hyperframes Strict",
  async render(input: RenderInput, ctx: RenderContext): Promise<RenderOutput> {
    if (typeof input.config.duration !== "number") {
      throw new Error("Qivance strict render requires numeric frame duration.");
    }
    const html = await readFile(input.template.sourcePath, "utf8");
    assertStrictFrameDuration({
      framePath: input.template.sourcePath,
      html,
      requestedDurationSec: input.config.duration,
      toleranceSec: 0.08,
    });
    return await hyperframesAdapter.render(input, ctx);
  },
};

export function assertStrictFrameDuration(input: {
  framePath: string;
  html: string;
  requestedDurationSec: number;
  toleranceSec: number;
}): void {
  const detected = detectFiniteAnimationDurationSec(input.html);
  if (detected > input.requestedDurationSec + input.toleranceSec) {
    throw new StrictDurationViolationError({
      framePath: input.framePath,
      requestedDurationSec: input.requestedDurationSec,
      detectedAnimationDurationSec: detected,
      toleranceSec: input.toleranceSec,
    });
  }
}

export function detectFiniteAnimationDurationSec(html: string): number {
  const css = stripHtmlComments(html);
  const durations: number[] = [];
  for (const declaration of css.matchAll(/animation\s*:\s*([^;{}]+)/gi)) {
    const value = declaration[1] ?? "";
    for (const part of value.split(",")) {
      if (/\binfinite\b/i.test(part)) continue;
      const times = [...part.matchAll(/(^|[\s(])(-?\d*\.?\d+)(m?s)\b/gi)]
        .map((match) => parseTime(Number(match[2]), match[3]));
      if (times.length > 0) durations.push(round((times[0] ?? 0) + Math.max(0, times[1] ?? 0)));
    }
  }

  const durationValues = parseTimeList(css, /animation-duration\s*:\s*([^;{}]+)/gi);
  const delayValues = parseTimeList(css, /animation-delay\s*:\s*([^;{}]+)/gi);
  for (let index = 0; index < durationValues.length; index += 1) {
    durations.push(round((durationValues[index] ?? 0) + Math.max(0, delayValues[index] ?? 0)));
  }

  return durations.length === 0 ? 0 : Math.max(...durations);
}

function parseTimeList(css: string, pattern: RegExp): number[] {
  return [...css.matchAll(pattern)].flatMap((match) =>
    (match[1] ?? "").split(",").map((part) => {
      const value = part.trim().match(/^(-?\d*\.?\d+)(m?s)$/i);
      return value ? parseTime(Number(value[1]), value[2]) : 0;
    }),
  );
}

function parseTime(value: number, unit: string): number {
  return unit.toLowerCase() === "ms" ? value / 1000 : value;
}

function stripHtmlComments(value: string): string {
  return value.replace(/<!--[\s\S]*?-->/g, "");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
