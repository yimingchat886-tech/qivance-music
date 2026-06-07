import test from "node:test";
import assert from "node:assert/strict";
import { assertStrictFrameDuration, detectFiniteAnimationDurationSec, StrictDurationViolationError } from "../src/lib/video-html/qivance-hyperframes-strict-adapter.ts";

test("strict duration accepts animation within requested duration", () => {
  const html = `<style>.title{animation:pop 2s ease .2s forwards}</style>`;

  assert.equal(detectFiniteAnimationDurationSec(html), 2.2);
  assert.doesNotThrow(() => assertStrictFrameDuration({
    framePath: "frames/ok.html",
    html,
    requestedDurationSec: 3,
    toleranceSec: 0.08,
  }));
});

test("strict duration rejects animation over requested duration", () => {
  const html = `<style>.title{animation:pop 5s ease 0s forwards}</style>`;

  assert.throws(
    () => assertStrictFrameDuration({
      framePath: "frames/bad.html",
      html,
      requestedDurationSec: 2,
      toleranceSec: 0.08,
    }),
    (error) => {
      assert.ok(error instanceof StrictDurationViolationError);
      assert.equal(error.code, "duration-policy-violation");
      assert.equal(error.details.requestedDurationSec, 2);
      assert.equal(error.details.detectedAnimationDurationSec, 5);
      return true;
    },
  );
});
