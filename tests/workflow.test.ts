import assert from "node:assert/strict";
import test from "node:test";
import { nextStateForStep, postMinimaxPath } from "../src/lib/workflow.ts";

test("defines the post-MiniMax preview happy path only", () => {
  assert.deepEqual(postMinimaxPath, [
    "music_accepted",
    "beat_locking",
    "beat_locked",
    "section_mapping",
    "timing_qa_running",
    "timing_ready",
    "scene_planning",
    "scene_qa_running",
    "scene_ready",
    "hypeframes_generating",
    "hypeframes_file_qa_running",
    "hypeframes_ready",
    "preview_rendering",
    "preview_ready",
    "render_qa_running",
    "render_passed",
    "export_ready",
  ]);
});

test("rejects transitions that jump over a QA gate", () => {
  assert.equal(nextStateForStep("music_accepted", "advance"), "beat_locking");
  assert.throws(
    () => nextStateForStep("music_accepted", "render_passed"),
    /Invalid workflow event/,
  );
});

