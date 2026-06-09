import { runMediaE2EWorkflow } from "../src/lib/media-e2e/workflow.ts";

const fixtureIndex = process.argv.indexOf("--fixture");
const fixture = fixtureIndex >= 0 ? process.argv[fixtureIndex + 1] : undefined;

if (!fixture) {
  console.error("usage: scripts/e2e-media-v2.ts --fixture <portrait-9x16|landscape-16x9|square-1x1>");
  process.exit(2);
}

await runMediaE2EWorkflow();
