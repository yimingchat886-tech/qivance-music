import { readFile, writeFile } from "node:fs/promises";
import { ProjectStore, type Project } from "@html-video/core";
import type { MediaProbe } from "../export/ffprobe.ts";
import { ffprobe } from "../export/ffprobe.ts";
import { muxLockedAudio } from "../export/mux-locked-audio.ts";
import { buildRenderManifest, type RenderManifest } from "../export/render-manifest.ts";
import { resolveSmallProjectPaths, type SmallProjectPaths } from "../project-core/paths.ts";
import { validateAnimationPlan, type AnimationPlan } from "../video-contract/animation-plan.schema.ts";
import { animationPlanToContentGraph } from "./animation-plan-to-content-graph.ts";
import { ensureHtmlVideoWorkspace } from "./html-video-workspace.ts";
import { loadHtmlVideoPreviewModel, type HtmlVideoPreviewModel } from "./preview-model.ts";
import { buildFrameContracts, type QivanceFrameContracts } from "./qivance-frame-contracts.ts";
import { runCodexFrameAgent, type CodexExecutor } from "./codex-frame-agent.ts";
import { renderHtmlVideoVisual } from "./render-html-video.ts";

export type HtmlVideoWorkflowResult = {
  smallProjectId: string;
  paths: SmallProjectPaths;
  preview: HtmlVideoPreviewModel;
  renderManifest: RenderManifest;
};

export type HtmlVideoWorkflowOptions = {
  storageRoot?: string;
  codexExecutor?: CodexExecutor;
  renderVisual?: (input: { paths: SmallProjectPaths; outputPath: string }) => Promise<void>;
  muxAudio?: (input: { visualMp4Path: string; masterAudioPath: string; finalMp4Path: string }) => Promise<void>;
  probeFinal?: (filePath: string) => Promise<MediaProbe>;
};

export async function runHtmlVideoWorkflow(
  smallProjectId: string,
  options: HtmlVideoWorkflowOptions = {},
): Promise<HtmlVideoWorkflowResult> {
  const storageRoot = options.storageRoot ?? process.env.QIVANCE_PROJECTS_ROOT ?? "projects";
  const paths = resolveSmallProjectPaths(storageRoot, smallProjectId);
  const animationPlan = JSON.parse(await readFile(`${paths.qivanceDir}/animation_plan.json`, "utf8")) as AnimationPlan;
  const validation = validateAnimationPlan(animationPlan);
  if (!validation.ok) {
    throw new Error(`AnimationPlan invalid: ${validation.issues.join("; ")}`);
  }

  const contentGraph = animationPlanToContentGraph(animationPlan);
  const frameContracts = buildFrameContracts({ plan: animationPlan, paths });
  await ensureHtmlVideoWorkspace({
    paths,
    animationPlan,
    contentGraph,
    frameContracts,
  });
  const codexResult = await runCodexFrameAgent({
    paths,
    ...(options.codexExecutor ? { executor: options.codexExecutor } : {}),
  });
  if (codexResult.exitCode !== 0) {
    throw new Error(`Codex frame agent failed with exit code ${codexResult.exitCode}: ${codexResult.stderr}`);
  }
  await syncProjectFramesFromContracts(paths, frameContracts);
  const preview = await loadHtmlVideoPreviewModel(paths);

  await (options.renderVisual ?? defaultRenderVisual)({ paths, outputPath: paths.visualMp4Path });
  await (options.muxAudio ?? muxLockedAudio)({
    visualMp4Path: paths.visualMp4Path,
    masterAudioPath: `${paths.audioMasterDir}/active_music_take.wav`,
    finalMp4Path: paths.finalMp4Path,
  });
  const finalProbe = await (options.probeFinal ?? ffprobe)(paths.finalMp4Path);
  const manifest = buildRenderManifest({
    smallProjectId,
    contentGraphPath: "video/html-video/.html-video/projects/" + smallProjectId + "/content-graph.json",
    frameContractsPath: "video/html-video/.html-video/projects/" + smallProjectId + "/qivance-frame-contracts.json",
    visualMp4Path: "exports/visual.mp4",
    masterAudioPath: "audio/master/active_music_take.wav",
    finalMp4Path: "exports/final.mp4",
    expected: {
      durationSec: animationPlan.targetDurationSec,
      fps: animationPlan.fps,
      resolution: animationPlan.resolution,
    },
    finalProbe,
  });
  await writeFile(paths.renderManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return {
    smallProjectId,
    paths,
    preview,
    renderManifest: manifest,
  };
}

async function defaultRenderVisual(input: { paths: SmallProjectPaths; outputPath: string }): Promise<void> {
  await renderHtmlVideoVisual(input);
}

async function syncProjectFramesFromContracts(paths: SmallProjectPaths, contracts: QivanceFrameContracts): Promise<void> {
  const store = new ProjectStore(paths.htmlVideoRoot);
  const project = await store.load(paths.smallProjectId);
  const frames = Object.values(contracts.frames)
    .sort((a, b) => a.order - b.order)
    .map((contract) => ({
      graphNodeId: contract.graphNodeId,
      htmlPath: `${paths.htmlVideoProjectDir}/${contract.allowedHtmlPath}`,
      durationSec: contract.durationSec,
      order: contract.order,
    }));
  const nextProject: Project = {
    ...project,
    frames,
    lastPreviewHtmlPath: frames[0]?.htmlPath,
    status: "previewed",
  };
  await store.save(nextProject);
}
