import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { validateMediaE2EFixtureBundle } from "../src/lib/media-e2e/fixture-contract.ts";
import type { MediaE2ERatio } from "../src/lib/media-e2e/types.ts";

const FIXTURES: MediaE2ERatio[] = ["portrait-9x16", "landscape-16x9", "square-1x1"];

for (const ratio of FIXTURES) {
  test(`validates committed ${ratio} fixture bundle`, async () => {
    const result = await validateMediaE2EFixtureBundle({
      bundlePath: path.join("fixtures", "media-e2e-v2", ratio),
      ratio,
    });

    assert.equal(result.ok, true, result.issues.join("\n"));
    assert.match(result.projectId ?? "", /^media_e2e_v2_/);
  });
}
