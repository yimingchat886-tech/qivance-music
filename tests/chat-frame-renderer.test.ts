import assert from "node:assert/strict";
import test from "node:test";
import { buildFrameConcatList, chromeScreenshotArgs } from "../src/lib/chat-dialogue/chat-frame-renderer.ts";

test("builds ffmpeg concat list with durations and duplicated final still frame", () => {
  const list = buildFrameConcatList([
    { screenshotPath: "/tmp/frame 1.png", durationSec: 1.25 },
    { screenshotPath: "/tmp/frame's 2.png", durationSec: 2 },
  ]);

  assert.match(list, /file '\/tmp\/frame 1\.png'/);
  assert.match(list, /duration 1\.250/);
  assert.match(list, /file '\/tmp\/frame'\\''s 2\.png'/);
  assert.match(list, /duration 2\.000/);
  assert.equal(list.trim().endsWith("file '/tmp/frame'\\''s 2.png'"), true);
});

test("builds deterministic headless Chrome screenshot args for local HTML frames", () => {
  const args = chromeScreenshotArgs({
    htmlPath: "/tmp/qivance/frame.html",
    screenshotPath: "/tmp/qivance/frame.png",
    width: 1080,
    height: 1920,
  });

  assert.ok(args.includes("--headless=new"));
  assert.ok(args.includes("--no-sandbox"));
  assert.ok(args.includes("--window-size=1080,1920"));
  assert.ok(args.includes("--screenshot=/tmp/qivance/frame.png"));
  assert.equal(args.at(-1), "file:///tmp/qivance/frame.html");
});
