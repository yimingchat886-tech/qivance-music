import assert from "node:assert/strict";
import test from "node:test";
import {
  buildV5SchedulerTaskSeeds,
  listEnabledV5Chains,
  readV5ChainRegistryEntry,
  requireEnabledV5Chain,
} from "../src/lib/chain-registry/chain-registry.ts";

test("V5 registry enables chat_dialogue_mv and video_chain", () => {
  assert.deepEqual(listEnabledV5Chains().map((entry) => entry.chain_id), ["chat_dialogue_mv", "video_chain"]);
  assert.equal(readV5ChainRegistryEntry("chat_dialogue_mv")?.required_timing, true);
  assert.deepEqual(readV5ChainRegistryEntry("video_chain")?.input_requirements, ["lyrics", "audio", "video"]);
  assert.equal(readV5ChainRegistryEntry("image_storyboard_mv"), null);
  assert.throws(() => requireEnabledV5Chain("unknown_chain"), /Unsupported V5 chain/);
  assert.throws(() => requireEnabledV5Chain("image_storyboard_mv"), /Unsupported V5 chain/);
});

test("V5 registry generates deterministic scheduler task seeds", () => {
  const seeds = buildV5SchedulerTaskSeeds("chat_dialogue_mv");
  assert.deepEqual(seeds.map((seed) => seed.stage), [
    "run_timing_pipeline",
    "build_lyrics_line_map",
    "build_speaker_attribution",
    "build_conversation_plan",
    "build_chat_frames",
    "render_visual",
    "mux_final",
    "qa_report",
    "write_manifest",
  ]);
  assert.deepEqual(seeds[0]?.dependencies, []);
  assert.deepEqual(seeds[1]?.dependencies, ["run_timing_pipeline"]);
  assert.deepEqual(seeds.at(-1)?.dependencies, ["qa_report"]);
  assert.ok(seeds[0]?.output_artifacts.includes("data/timing/section_map.json"));
  assert.ok(seeds[4]?.output_artifacts.includes("data/chains/chat_dialogue_mv/runtime_timeline.json"));
  assert.ok(seeds[4]?.output_artifacts.includes("video/html-video/.html-video/projects/<project_id>/runtime/chat_dialogue_mv.html"));
  assert.equal(seeds[4]?.output_artifacts.includes("data/chains/chat_dialogue_mv/frame_contracts.json"), false);
  assert.ok(seeds.at(-1)?.output_artifacts.includes("exports/chat_dialogue_mv/render_manifest.json"));
});

test("V5 registry generates video_chain preview scheduler task seeds by default", () => {
  const seeds = buildV5SchedulerTaskSeeds("video_chain");
  assert.deepEqual(seeds.map((seed) => seed.stage), [
    "run_timing_pipeline",
    "prepare_video_context",
    "build_video_frames",
  ]);
  assert.deepEqual(seeds[1]?.dependencies, ["run_timing_pipeline"]);
  assert.deepEqual(seeds.at(-1)?.dependencies, ["prepare_video_context"]);
  assert.ok(seeds[2]?.resource_requirements.includes("html_video_agent"));
  assert.ok(seeds[2]?.output_artifacts.includes("data/chains/video_chain/frame_contracts.json"));
  assert.equal(seeds.some((seed) => seed.stage === "render_video_visual"), false);
  assert.equal(seeds.some((seed) => seed.output_artifacts.includes("exports/video_chain/render_manifest.json")), false);
});

test("V5 registry generates video_chain export scheduler task seeds by phase", () => {
  const seeds = buildV5SchedulerTaskSeeds("video_chain", { phase: "export" });
  assert.deepEqual(seeds.map((seed) => seed.stage), [
    "render_video_visual",
    "mux_video_final",
    "video_qa_report",
    "write_video_manifest",
  ]);
  assert.deepEqual(seeds[0]?.dependencies, []);
  assert.deepEqual(seeds[1]?.dependencies, ["render_video_visual"]);
  assert.deepEqual(seeds.at(-1)?.dependencies, ["video_qa_report"]);
  assert.ok(seeds.at(-1)?.output_artifacts.includes("exports/video_chain/render_manifest.json"));
});
