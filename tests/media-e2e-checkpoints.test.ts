import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readStepCheckpoint, writeStepCheckpoint } from "../src/lib/media-e2e/checkpoints.ts";

test("writes and reads a completed workflow checkpoint", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "qivance-media-e2e-checkpoints-"));

  await writeStepCheckpoint(projectRoot, {
    step: "validate_fixture_bundle",
    status: "passed",
    inputs: ["animation_plan.json"],
    outputs: ["checkpoint.json"],
    diagnostics: [],
  });

  const checkpoint = await readStepCheckpoint(projectRoot, "validate_fixture_bundle");

  assert.equal(checkpoint?.status, "passed");
  assert.equal(checkpoint?.step, "validate_fixture_bundle");
  assert.deepEqual(checkpoint?.inputs, ["animation_plan.json"]);
});
