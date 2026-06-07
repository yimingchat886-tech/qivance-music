import type { ContentGraph } from "@html-video/content-graph";
import { validate, topoSort, totalDurationSec } from "@html-video/content-graph";
import type { AnimationPlan } from "../video-contract/animation-plan.schema.ts";

export function animationPlanToContentGraph(plan: AnimationPlan): ContentGraph {
  const scenes = [...plan.scenes].sort((a, b) => a.order - b.order);
  const graph: ContentGraph = {
    schemaVersion: 1,
    intent: "explainer",
    synopsis: plan.synopsis || "90-120s rap teaching short video",
    nodes: scenes.map((scene) => ({
      id: scene.id,
      kind: "text",
      label: scene.headline,
      frameIntent: scene.frameIntent,
      durationSec: scene.durationSec,
      text: [scene.headline, ...scene.bodyLines].join("\n"),
    })),
    edges: scenes.slice(0, -1).map((scene, index) => ({
      from: scene.id,
      to: scenes[index + 1].id,
      kind: "sequence",
    })),
  };

  const result = validate(graph);
  if (!result.ok) {
    throw new Error(`ContentGraph invalid: ${result.errors.map((error) => error.message).join("; ")}`);
  }
  topoSort(graph);
  const durationDrift = Math.abs(totalDurationSec(graph) - plan.targetDurationSec);
  if (durationDrift > 0.2) {
    throw new Error(`ContentGraph duration drift exceeds 0.2s: ${durationDrift.toFixed(3)}s`);
  }
  return graph;
}
