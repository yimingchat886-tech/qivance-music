import test from "node:test";
import assert from "node:assert/strict";
import { validateFrameHtmlReferences } from "../src/lib/video-html/frame-output-validator.ts";

test("rejects external image references", () => {
  const result = validateFrameHtmlReferences({
    html: `<img src="https://example.com/bg.png">`,
    allowedLocalImagePaths: ["assets/images/generated/bg.png"],
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /external image/);
});

test("accepts locked local image references", () => {
  const result = validateFrameHtmlReferences({
    html: `<img src="assets/images/generated/bg.png">`,
    allowedLocalImagePaths: ["assets/images/generated/bg.png"],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("rejects unlocked local image references", () => {
  const result = validateFrameHtmlReferences({
    html: `<img src="assets/images/generated/unlocked.png">`,
    allowedLocalImagePaths: ["assets/images/generated/bg.png"],
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /unlocked local image/);
});
