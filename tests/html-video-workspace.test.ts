import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { validate, topoSort, totalDurationSec } from "@html-video/content-graph";
import { resolveSmallProjectPaths } from "../src/lib/project-core/paths.ts";
import { type AnimationPlan } from "../src/lib/video-contract/animation-plan.schema.ts";
import { animationPlanToContentGraph } from "../src/lib/video-html/animation-plan-to-content-graph.ts";
import { buildFrameContracts } from "../src/lib/video-html/qivance-frame-contracts.ts";
import { ensureHtmlVideoWorkspace } from "../src/lib/video-html/html-video-workspace.ts";

function plan(): AnimationPlan {
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
        beatSync: { intensity: 0.9, preferredBeatRange: [0, 4] },
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
  };
}

test("AnimationPlan maps deterministically to a valid html-video ContentGraph", () => {
  const graphA = animationPlanToContentGraph(plan());
  const graphB = animationPlanToContentGraph(plan());

  assert.equal(JSON.stringify(graphA), JSON.stringify(graphB));
  assert.equal(validate(graphA).ok, true);
  assert.deepEqual(topoSort(graphA), ["scene_001_hook", "scene_002_explain"]);
  assert.equal(totalDurationSec(graphA), 8);
  assert.deepEqual(graphA.nodes.map((node) => node.kind), ["text", "text"]);
  assert.deepEqual(graphA.edges, [{ from: "scene_001_hook", to: "scene_002_explain", kind: "sequence" }]);
});

test("frame contracts preserve strict scene timing and allowed output paths", () => {
  const paths = resolveSmallProjectPaths("/tmp/qivance-projects", "sp_demo_001");
  const contracts = buildFrameContracts({ plan: plan(), paths });

  assert.equal(contracts.smallProjectId, "sp_demo_001");
  assert.equal(contracts.durationPolicy, "strict");
  assert.equal(contracts.totalDurationSec, 8);
  assert.equal(contracts.frames.scene_001_hook.allowedHtmlPath, "frames/01-scene_001_hook.html");
  assert.equal(contracts.frames.scene_001_hook.strictDuration, true);
  assert.deepEqual(contracts.frames.scene_001_hook.beatRange, [0, 4]);
});

test("workspace writer saves html-video project id equal to small project id", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "qivance-html-video-workspace-"));
  const paths = resolveSmallProjectPaths(storageRoot, "sp_demo_001");
  const animationPlan = plan();
  const contentGraph = animationPlanToContentGraph(animationPlan);
  const frameContracts = buildFrameContracts({ plan: animationPlan, paths });

  const workspace = await ensureHtmlVideoWorkspace({
    paths,
    animationPlan,
    contentGraph,
    frameContracts,
  });

  await stat(workspace.projectJsonPath);
  await stat(workspace.contentGraphPath);
  await stat(workspace.frameContractsPath);
  await stat(workspace.codexDir);
  await stat(workspace.framesDir);
  const project = JSON.parse(await readFile(workspace.projectJsonPath, "utf8"));
  const graph = JSON.parse(await readFile(workspace.contentGraphPath, "utf8"));
  const sidecar = JSON.parse(await readFile(workspace.frameContractsPath, "utf8"));

  assert.equal(project.id, "sp_demo_001");
  assert.equal(project.name, "RAG Rap");
  assert.equal(project.preferences.fps, 30);
  assert.equal(graph.nodes[0].id, "scene_001_hook");
  assert.equal(sidecar.frames.scene_002_explain.durationSec, 4);
});
