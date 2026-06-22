import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  chromeRuntimeRecordingArgs,
  ffmpegImageSequenceArgs,
  frameCountForTimeline,
  renderChatRuntimeToVisual,
  type CaptureRuntimeScreenshotsInput,
} from "../src/lib/chat-dialogue/chat-browser-recorder.ts";
import type { ChatRuntimeTimeline } from "../src/lib/chat-dialogue/chat-runtime-timeline.ts";

test("computes frame count and command args for browser recording", () => {
  assert.equal(frameCountForTimeline({ duration_sec: 1.01 }, 60), 61);
  assert.deepEqual(chromeRuntimeRecordingArgs({
    remoteDebuggingPort: 9222,
    runtimeHtmlAbsolutePath: "/tmp/runtime.html",
    width: 1080,
    height: 1920,
  }).slice(0, 7), [
    "--headless=new",
    "--remote-debugging-port=9222",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--hide-scrollbars",
    "--window-size=1080,1920",
  ]);
  assert.deepEqual(ffmpegImageSequenceArgs({
    renderRoot: "/tmp/frames",
    fps: 60,
    outputPath: "/tmp/visual.mp4",
  }), [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-framerate",
    "60",
    "-i",
    "/tmp/frames/frame_%06d.png",
    "-vf",
    "fps=60,format=yuv420p",
    "-movflags",
    "+faststart",
    "/tmp/visual.mp4",
  ]);
});

test("writes browser render evidence after mocked capture and ffmpeg", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "qivance-browser-recorder-"));
  await writeFile(path.join(projectRoot, "runtime.html"), "<!doctype html>", "utf8");
  let captureInput: CaptureRuntimeScreenshotsInput | undefined;
  let ffmpegFile = "";
  let ffmpegArgs: string[] = [];

  const evidence = await renderChatRuntimeToVisual({
    projectRoot,
    runtimeHtmlPath: "runtime.html",
    runtimeTimeline: runtimeTimelineFixture(),
    outputPath: "exports/chat_dialogue_mv/visual.mp4",
    chromeExecutable: "chrome-test",
  }, {
    captureScreenshots: async (input) => {
      captureInput = input;
      return { chromeExecutable: input.chromeExecutable };
    },
    execFile: (async (file: string, args: string[]) => {
      ffmpegFile = file;
      ffmpegArgs = args;
      return { stdout: "", stderr: "" };
    }) as never,
    sha256File: async () => "visual-sha",
  });

  assert.equal(captureInput?.chromeExecutable, "chrome-test");
  assert.equal(captureInput?.width, 1080);
  assert.equal(captureInput?.height, 1920);
  assert.equal(captureInput?.fps, 60);
  assert.equal(captureInput?.frameCount, 90);
  assert.equal(ffmpegFile, "ffmpeg");
  assert.equal(ffmpegArgs.includes("-framerate"), true);
  assert.equal(ffmpegArgs.includes("60"), true);
  assert.equal(ffmpegArgs.includes("fps=60,format=yuv420p"), true);
  assert.equal(evidence.frame_count, 90);
  assert.equal(evidence.visual_sha256, "visual-sha");
  assert.equal(evidence.capture_strategy, "cdp_virtual_time_screenshots");

  const evidenceJson = JSON.parse(await readFile(path.join(projectRoot, "data/chains/chat_dialogue_mv/browser_render_evidence.json"), "utf8"));
  assert.equal(evidenceJson.runtime_html_path, "runtime.html");
  assert.equal(evidenceJson.output_path, "exports/chat_dialogue_mv/visual.mp4");
  await assert.rejects(stat(path.join(projectRoot, "data/chains/chat_dialogue_mv/browser_render_frames")));
});

function runtimeTimelineFixture(): ChatRuntimeTimeline {
  return {
    schema_version: 1,
    chain_id: "chat_dialogue_mv",
    render_mode: "browser_recording",
    target_ratio: "9:16",
    width: 1080,
    height: 1920,
    fps: 60,
    duration_sec: 1.5,
    events: [{ type: "end", at_sec: 1.5 }],
    css_motion: {
      right_bubble_ms: 230,
      left_bubble_ms: 260,
      receipt_in_ms: 120,
      receipt_out_ms: 100,
      header_swap_ms: 120,
      left_enter_delay_ms: 40,
    },
  };
}
