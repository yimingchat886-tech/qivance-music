import assert from "node:assert/strict";
import test from "node:test";
import { nextStateForStep, postMinimaxPath } from "../src/lib/workflow.ts";

test("defines the post-MiniMax preview happy path only", () => {
  assert.deepEqual(postMinimaxPath, [
    "music_locking",
    "music_locked",
    "beat_locking",
    "beat_locked",
    "section_mapping",
    "section_mapped",
    "timing_checking",
    "timing_passed",
    "storyboard_generating",
    "storyboard_generated",
    "scene_rule_checking",
    "scene_rule_passed",
    "scene_waiting_human",
    "scene_human_approved",
    "hypeframes_generating",
    "hypeframes_project_ready",
    "hypeframes_file_qa_checking",
    "hypeframes_file_qa_passed",
    "preview_rendering",
    "preview_rendered",
    "render_file_qa_checking",
    "render_file_qa_passed",
    "preview_waiting_human",
    "preview_human_approved",
    "hypeframes_video_ready",
  ]);
});

test("rejects transitions that jump over a QA gate", () => {
  assert.equal(nextStateForStep("music_locking", "advance"), "music_locked");
  assert.throws(
    () => nextStateForStep("music_locking", "render_file_qa_passed"),
    /Invalid workflow event/,
  );
});
