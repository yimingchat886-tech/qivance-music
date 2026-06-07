import { mkdir, writeFile } from "node:fs/promises";
import { AssetStore, EngineRegistry, ProjectOrchestrator, ProjectStore, TemplateRegistry, type Project } from "@html-video/core";
import type { ContentGraph } from "@html-video/content-graph";
import type { SmallProjectPaths } from "../project-core/paths.ts";
import type { AnimationPlan } from "../video-contract/animation-plan.schema.ts";
import { buildAgentContext, type AgentContext } from "../video-contract/agent-context.schema.ts";
import type { QivanceFrameContracts } from "./qivance-frame-contracts.ts";

export type HtmlVideoWorkspace = {
  smallProjectId: string;
  htmlVideoRoot: string;
  htmlVideoProjectDir: string;
  projectJsonPath: string;
  contentGraphPath: string;
  frameContractsPath: string;
  codexDir: string;
  framesDir: string;
  codexAgentContextPath: string;
};

export async function ensureHtmlVideoWorkspace(input: {
  paths: SmallProjectPaths;
  animationPlan: AnimationPlan;
  contentGraph: ContentGraph;
  frameContracts: QivanceFrameContracts;
}): Promise<HtmlVideoWorkspace> {
  const paths = input.paths;
  await Promise.all([
    mkdir(paths.qivanceDir, { recursive: true }),
    mkdir(paths.timingDir, { recursive: true }),
    mkdir(paths.audioMasterDir, { recursive: true }),
    mkdir(paths.exportsDir, { recursive: true }),
    mkdir(paths.codexDir, { recursive: true }),
    mkdir(paths.framesDir, { recursive: true }),
  ]);

  const projectStore = new ProjectStore(paths.htmlVideoRoot);
  const now = new Date().toISOString();
  const project: Project = {
    id: input.animationPlan.smallProjectId,
    name: input.animationPlan.title,
    intent: input.animationPlan.category,
    assets: [],
    templateId: null,
    variables: {},
    preferences: {
      resolution: input.animationPlan.resolution,
      fps: input.animationPlan.fps,
      aspect: input.animationPlan.aspectRatio,
      durationTargetSec: input.animationPlan.targetDurationSec,
      mood: input.animationPlan.mood,
    },
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };

  await projectStore.save(project);
  const orchestrator = new ProjectOrchestrator({
    projectRoot: paths.htmlVideoRoot,
    engines: new EngineRegistry(),
    templates: new TemplateRegistry(),
    projects: projectStore,
    assets: new AssetStore({ projectRoot: paths.htmlVideoRoot }),
  });
  await orchestrator.writeContentGraph(project.id, input.contentGraph);
  await writeJson(paths.frameContractsPath, input.frameContracts);
  const agentContext = buildAgentContext({ plan: input.animationPlan, paths });
  await writeJson(paths.codexAgentContextPath, agentContext);
  await writeJson(`${paths.qivanceDir}/animation_plan.json`, input.animationPlan);

  return {
    smallProjectId: paths.smallProjectId,
    htmlVideoRoot: paths.htmlVideoRoot,
    htmlVideoProjectDir: paths.htmlVideoProjectDir,
    projectJsonPath: paths.projectJsonPath,
    contentGraphPath: paths.contentGraphPath,
    frameContractsPath: paths.frameContractsPath,
    codexDir: paths.codexDir,
    framesDir: paths.framesDir,
    codexAgentContextPath: paths.codexAgentContextPath,
  };
}

async function writeJson(filePath: string, value: QivanceFrameContracts | AnimationPlan | AgentContext): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
