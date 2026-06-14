import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runMediaE2EWorkflow } from "../src/lib/media-e2e/workflow.ts";
import type { MediaE2ERatio } from "../src/lib/media-e2e/types.ts";

const ratios: MediaE2ERatio[] = ["portrait-9x16", "landscape-16x9", "square-1x1"];
const fixtureIndex = process.argv.indexOf("--fixture");
const fixture = fixtureIndex >= 0 ? process.argv[fixtureIndex + 1] : undefined;
const runAll = process.argv.includes("--all");
const reportPath = path.resolve(argValue("--report") ?? "docs/TEST_REPORT.v3.md");
const storageRoot = path.resolve(argValue("--storage-root") ?? path.join("projects", `v3_media_regression_${stamp()}`));
const reviewRoot = path.join(storageRoot, "_review_decisions");

for (const forbiddenFlag of ["--allow-cached-imagegen", "--allow-fallback-frames", "--allow-auto-lock-image-assets", "--allow-cpu-whisperx-diagnostic"]) {
  if (process.argv.includes(forbiddenFlag)) {
    console.error(`${forbiddenFlag} is forbidden in V3 production-strict regression.`);
    process.exit(2);
  }
}

if (!runAll && !fixture) {
  console.error("usage: scripts/e2e-media-v3-regression.ts --all | --fixture <portrait-9x16|landscape-16x9|square-1x1> [--storage-root <path>] [--report <path>]");
  process.exit(2);
}

const selected = runAll ? ratios : [fixture as MediaE2ERatio];
const results = [];
for (const ratio of selected) {
  if (!ratios.includes(ratio)) {
    console.error("invalid fixture ratio: " + ratio);
    process.exit(2);
  }
  const reviewDecisionPath = await writeReviewDecisionFixture(ratio);
  const result = await runMediaE2EWorkflow({
    fixtureRatio: ratio,
    storageRoot,
    reviewDecisionPath,
    reportPath,
    allowCachedImagegen: false,
    allowFallbackFrames: false,
    allowAutoLockImageAssets: false,
    allowCpuWhisperXDiagnostic: false,
  });
  results.push(result);
}

console.log(JSON.stringify({
  status: "passed",
  storage_root: storageRoot,
  report_path: reportPath,
  results,
}, null, 2));

async function writeReviewDecisionFixture(ratio: MediaE2ERatio): Promise<string> {
  const fixtureRoot = path.resolve("fixtures", "media-e2e-v2", ratio);
  const animationPlan = await readJson<{ small_project_id: string }>(path.join(fixtureRoot, "animation_plan.json"));
  const imagePlan = await readJson<{ requests: Array<{ request_id: string }> }>(path.join(fixtureRoot, "image_generation_plan.json"));
  const request = imagePlan.requests[0];
  if (!request) throw new Error(`image_generation_plan has no requests for ${ratio}`);
  const reviewDecisionPath = path.join(reviewRoot, `${ratio}.json`);
  await mkdir(path.dirname(reviewDecisionPath), { recursive: true });
  await writeJson(reviewDecisionPath, {
    schema_version: 1,
    small_project_id: animationPlan.small_project_id,
    decisions: [
      {
        candidate_id: `${request.request_id}_v1`,
        status: "locked",
        reason: "approved for V3 production-strict regression",
        decided_by: "e2e-media-v3-regression",
      },
    ],
  });
  return reviewDecisionPath;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function stamp(): string {
  return new Date().toISOString().replaceAll(/[^0-9]+/g, "").slice(0, 14);
}
