import { AssetStore, EngineRegistry, ProjectOrchestrator, ProjectStore, TemplateRegistry, type EngineAdapter } from "@html-video/core";
import type { SmallProjectPaths } from "../project-core/paths.ts";
import { qivanceHyperframesStrictAdapter } from "./qivance-hyperframes-strict-adapter.ts";

export async function renderHtmlVideoVisual(input: {
  paths: SmallProjectPaths;
  outputPath?: string;
}): Promise<void> {
  const engines = new EngineRegistry();
  engines.register({ ...qivanceHyperframesStrictAdapter, id: "hyperframes" } as EngineAdapter);
  const projectStore = new ProjectStore(input.paths.htmlVideoRoot);
  const orchestrator = new ProjectOrchestrator({
    projectRoot: input.paths.htmlVideoRoot,
    engines,
    templates: new TemplateRegistry(),
    projects: projectStore,
    assets: new AssetStore({ projectRoot: input.paths.htmlVideoRoot }),
  });
  await orchestrator.exportMp4({
    projectId: input.paths.smallProjectId,
    outputPath: input.outputPath ?? input.paths.visualMp4Path,
  });
}
