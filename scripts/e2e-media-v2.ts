import { runMediaE2EWorkflow } from "../src/lib/media-e2e/workflow.ts";
import type { MediaE2ERatio } from "../src/lib/media-e2e/types.ts";

const ratios: MediaE2ERatio[] = ["portrait-9x16", "landscape-16x9", "square-1x1"];
const fixtureIndex = process.argv.indexOf("--fixture");
const fixture = fixtureIndex >= 0 ? process.argv[fixtureIndex + 1] : undefined;
const runAll = process.argv.includes("--all");
const allowCachedImagegen = process.argv.includes("--allow-cached-imagegen");
const allowFallbackFrames = process.argv.includes("--allow-fallback-frames");
const allowAutoLockImageAssets = process.argv.includes("--allow-auto-lock-image-assets");
const allowCpuWhisperXDiagnostic = process.argv.includes("--allow-cpu-whisperx-diagnostic");
const reviewDecisionIndex = process.argv.indexOf("--review-decisions");
const reviewDecisionPath = reviewDecisionIndex >= 0 ? process.argv[reviewDecisionIndex + 1] : undefined;

if (!runAll && !fixture) {
  console.error("usage: scripts/e2e-media-v2.ts --fixture <portrait-9x16|landscape-16x9|square-1x1> | --all [--review-decisions <path>] [--allow-cached-imagegen] [--allow-fallback-frames] [--allow-auto-lock-image-assets] [--allow-cpu-whisperx-diagnostic]");
  process.exit(2);
}

const selected = runAll ? ratios : [fixture as MediaE2ERatio];
for (const ratio of selected) {
  if (!ratios.includes(ratio)) {
    console.error("invalid fixture ratio: " + ratio);
    process.exit(2);
  }
  await runMediaE2EWorkflow({
    fixtureRatio: ratio,
    allowCachedImagegen,
    allowFallbackFrames,
    allowAutoLockImageAssets,
    allowCpuWhisperXDiagnostic,
    reviewDecisionPath,
  });
}
