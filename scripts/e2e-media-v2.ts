import { runMediaE2EWorkflow } from "../src/lib/media-e2e/workflow.ts";
import type { MediaE2ERatio } from "../src/lib/media-e2e/types.ts";

const ratios: MediaE2ERatio[] = ["portrait-9x16", "landscape-16x9", "square-1x1"];
const fixtureIndex = process.argv.indexOf("--fixture");
const fixture = fixtureIndex >= 0 ? process.argv[fixtureIndex + 1] : undefined;
const runAll = process.argv.includes("--all");

if (!runAll && !fixture) {
  console.error("usage: scripts/e2e-media-v2.ts --fixture <portrait-9x16|landscape-16x9|square-1x1> | --all");
  process.exit(2);
}

const selected = runAll ? ratios : [fixture as MediaE2ERatio];
for (const ratio of selected) {
  if (!ratios.includes(ratio)) {
    console.error("invalid fixture ratio: " + ratio);
    process.exit(2);
  }
  await runMediaE2EWorkflow({ fixtureRatio: ratio });
}
