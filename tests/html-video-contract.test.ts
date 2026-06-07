import test from "node:test";
import assert from "node:assert/strict";
import { resolveSmallProjectPaths } from "../src/lib/project-core/paths.ts";
import { validateAnimationPlan, type AnimationPlan } from "../src/lib/video-contract/animation-plan.schema.ts";
import { buildAgentContext } from "../src/lib/video-contract/agent-context.schema.ts";

function validPlan(overrides: Partial<AnimationPlan> = {}): AnimationPlan {
  return {
    schemaVersion: 1,
    smallProjectId: "sp_demo_001",
    title: "RAG Rap",
    category: "ai_concept",
    targetDurationSec: 8,
    fps: 30,
    resolution: { width: 1080, height: 1920 },
    aspectRatio: "9:16",
    mood: "cyber rap",
    synopsis: "Teach RAG with a short hook.",
    scenes: [
      {
        id: "scene_001_hook",
        order: 0,
        sectionId: "sec_hook",
        startSec: 0,
        endSec: 4,
        durationSec: 4,
        frameIntent: "kinetic-rap-hook",
        headline: "RAG checks facts first",
        bodyLines: ["retrieve", "augment", "generate"],
        captionMode: "word_highlight",
        visualDirectives: ["large kinetic type"],
        beatSync: { intensity: 0.9, hitPointsSec: [0.5, 1.5] },
      },
      {
        id: "scene_002_explain",
        order: 1,
        sectionId: "sec_explain",
        startSec: 4,
        endSec: 8,
        durationSec: 4,
        frameIntent: "cyber-definition",
        headline: "Search before the answer",
        bodyLines: ["less guessing", "more grounded output"],
        captionMode: "line_caption",
        visualDirectives: ["diagram split"],
        beatSync: { intensity: 0.6 },
      },
    ],
    ...overrides,
  };
}

test("project paths keep html-video project id equal to small project id", () => {
  const paths = resolveSmallProjectPaths("/tmp/qivance-projects", "sp_demo_001");

  assert.equal(paths.smallProjectId, "sp_demo_001");
  assert.equal(paths.projectRoot, "/tmp/qivance-projects/sp_demo_001");
  assert.equal(
    paths.htmlVideoProjectDir,
    "/tmp/qivance-projects/sp_demo_001/video/html-video/.html-video/projects/sp_demo_001",
  );
  assert.equal(paths.contentGraphPath, `${paths.htmlVideoProjectDir}/content-graph.json`);
  assert.equal(paths.frameContractsPath, `${paths.htmlVideoProjectDir}/qivance-frame-contracts.json`);
  assert.equal(paths.codexAgentContextPath, `${paths.htmlVideoProjectDir}/codex/agent_context.json`);
});

test("AnimationPlan validation accepts a contiguous strict-duration plan", () => {
  assert.deepEqual(validateAnimationPlan(validPlan()), { ok: true, issues: [] });
});

test("AnimationPlan validation rejects non-contiguous order and duration drift", () => {
  const plan = validPlan({
    targetDurationSec: 10,
    scenes: [
      { ...validPlan().scenes[0], order: 0, durationSec: 3 },
      { ...validPlan().scenes[1], order: 3 },
    ],
  });

  const result = validateAnimationPlan(plan);

  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /scene.order must be contiguous/);
  assert.match(result.issues.join("\n"), /durationSec must match endSec - startSec/);
  assert.match(result.issues.join("\n"), /scene durations must sum/);
});

test("AgentContext uses strict duration and forbids upstream writes", () => {
  const paths = resolveSmallProjectPaths("/tmp/qivance-projects", "sp_demo_001");
  const context = buildAgentContext({
    plan: validPlan(),
    paths,
  });

  assert.equal(context.mode, "html_video_frame_author");
  assert.equal(context.durationPolicy, "strict");
  assert.equal(context.contentGraphPath, "content-graph.json");
  assert.equal(context.frameContractsPath, "qivance-frame-contracts.json");
  assert.deepEqual(context.allowedWritePaths, ["frames/**/*.html", "codex/**", "qa/**"]);
  assert.ok(context.forbiddenWritePaths.includes("content-graph.json"));
  assert.ok(context.forbiddenWritePaths.includes("../../**"));
});
