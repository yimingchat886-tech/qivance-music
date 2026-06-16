import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRenderManifestV3,
  validateRenderManifestV3,
  type RenderManifestV3EvidenceRef,
} from "../src/lib/export/render-manifest-v3.ts";
import { SOURCE_VIDEO_FIXTURE_PROBE } from "./source-video-fixture.ts";

test("validates image/music production evidence with review decisions and agent runs", () => {
  const manifest = buildRenderManifestV3({
    smallProjectId: "media_e2e_v2_portrait_9x16",
    primaryRatio: "9:16",
    projectMode: "image_music_mode",
    imageSchedule: evidence("data/storyboard/image_generation_schedule.json"),
    imagePromptGroup: evidence("data/storyboard/image_prompt_group.json"),
    imageReviewDecisions: evidence("data/storyboard/image_review_decisions.json"),
    agentRuns: [
      {
        ...evidence("video/html-video/.html-video/projects/p/agent_runs/agent_run_001.json"),
        mode: "production",
        ai_authored_frame_count: 3,
      },
    ],
  });

  const validation = validateRenderManifestV3(manifest);

  assert.equal(validation.ok, true, validation.issues.join("\n"));
  assert.equal(manifest.v3.source_video.enabled, false);
  assert.equal(manifest.v3.production_evidence.fallback_frames_used, false);
});

test("blocks production manifest with missing review or agent evidence", () => {
  const manifest = buildRenderManifestV3({
    smallProjectId: "media_e2e_v2_portrait_9x16",
    primaryRatio: "9:16",
    projectMode: "image_music_mode",
    imageSchedule: evidence("data/storyboard/image_generation_schedule.json"),
    imagePromptGroup: evidence("data/storyboard/image_prompt_group.json"),
    agentRuns: [],
  });

  const validation = validateRenderManifestV3(manifest);
  const issues = validation.issues.join("\n");

  assert.equal(validation.ok, false);
  assert.match(issues, /image_review_decisions/);
  assert.match(issues, /agent_runs must include/);
});

test("blocks fallback frames, diagnostic flags, diagnostic agent runs, and missing AI-authored frame counts", () => {
  const manifest = buildRenderManifestV3({
    smallProjectId: "media_e2e_v2_portrait_9x16",
    primaryRatio: "9:16",
    projectMode: "image_music_mode",
    imageSchedule: evidence("data/storyboard/image_generation_schedule.json"),
    imagePromptGroup: evidence("data/storyboard/image_prompt_group.json"),
    imageReviewDecisions: evidence("data/storyboard/image_review_decisions.json"),
    agentRuns: [
      {
        ...evidence("video/html-video/.html-video/projects/p/agent_runs/agent_run_diag.json"),
        mode: "diagnostic",
        ai_authored_frame_count: 0,
      },
    ],
    fallbackFramesUsed: true,
    diagnosticFlagsUsed: ["allow_fallback_frames"],
  });

  const validation = validateRenderManifestV3(manifest);
  const issues = validation.issues.join("\n");

  assert.equal(validation.ok, false);
  assert.match(issues, /fallback_frames_used must be false/);
  assert.match(issues, /diagnostic_flags_used must be empty/);
  assert.match(issues, /mode must be production/);
  assert.match(issues, /ai_authored_frame_count/);
});

test("validates source video mode with original audio preservation evidence", () => {
  const manifest = buildRenderManifestV3({
    smallProjectId: "source_video_demo",
    primaryRatio: "9:16",
    projectMode: "source_video_mode",
    agentRuns: [
      {
        ...evidence("video/html-video/.html-video/projects/p/agent_runs/agent_run_001.json"),
        mode: "production",
        ai_authored_frame_count: 1,
      },
    ],
    sourceVideo: {
      enabled: true,
      ...evidence("data/source/source_video_import.json"),
      audio_policy: "preserve_source_audio",
      final_audio_source: "source_video.mp4",
      source_mp4_sha256: "source-sha",
      ffprobe: SOURCE_VIDEO_FIXTURE_PROBE,
    },
  });

  const validation = validateRenderManifestV3(manifest);

  assert.equal(validation.ok, true, validation.issues.join("\n"));
  if (manifest.v3.source_video.enabled) {
    assert.equal(manifest.v3.source_video.final_audio_source, "source_video.mp4");
    assert.equal(manifest.v3.source_video.audio_policy, "preserve_source_audio");
  }
});

function evidence(path: string): RenderManifestV3EvidenceRef {
  return { path, sha256: `${path}-sha` };
}
