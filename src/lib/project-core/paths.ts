import path from "node:path";

export type SmallProjectPaths = {
  smallProjectId: string;
  storageRoot: string;
  projectRoot: string;
  qivanceDir: string;
  timingDir: string;
  audioMasterDir: string;
  exportsDir: string;
  htmlVideoRoot: string;
  htmlVideoProjectDir: string;
  projectJsonPath: string;
  contentGraphPath: string;
  frameContractsPath: string;
  framesDir: string;
  codexDir: string;
  codexAgentContextPath: string;
  codexPromptPath: string;
  codexResultPath: string;
  visualMp4Path: string;
  finalMp4Path: string;
  renderManifestPath: string;
};

export function resolveSmallProjectPaths(storageRoot: string, smallProjectId: string): SmallProjectPaths {
  assertSafeSmallProjectId(smallProjectId);
  const root = path.resolve(storageRoot);
  const projectRoot = path.join(root, smallProjectId);
  const htmlVideoRoot = path.join(projectRoot, "video", "html-video");
  const htmlVideoProjectDir = path.join(htmlVideoRoot, ".html-video", "projects", smallProjectId);
  const codexDir = path.join(htmlVideoProjectDir, "codex");
  const exportsDir = path.join(projectRoot, "exports");

  return normalizePaths({
    smallProjectId,
    storageRoot: root,
    projectRoot,
    qivanceDir: path.join(projectRoot, "qivance"),
    timingDir: path.join(projectRoot, "timing"),
    audioMasterDir: path.join(projectRoot, "audio", "master"),
    exportsDir,
    htmlVideoRoot,
    htmlVideoProjectDir,
    projectJsonPath: path.join(htmlVideoProjectDir, "project.json"),
    contentGraphPath: path.join(htmlVideoProjectDir, "content-graph.json"),
    frameContractsPath: path.join(htmlVideoProjectDir, "qivance-frame-contracts.json"),
    framesDir: path.join(htmlVideoProjectDir, "frames"),
    codexDir,
    codexAgentContextPath: path.join(codexDir, "agent_context.json"),
    codexPromptPath: path.join(codexDir, "prompt.md"),
    codexResultPath: path.join(codexDir, "result.jsonl"),
    visualMp4Path: path.join(exportsDir, "visual.mp4"),
    finalMp4Path: path.join(exportsDir, "final.mp4"),
    renderManifestPath: path.join(exportsDir, "render_manifest.json"),
  });
}

export function toProjectRelative(paths: SmallProjectPaths, absolutePath: string): string {
  const relative = path.relative(paths.htmlVideoProjectDir, absolutePath);
  return normalizePath(relative);
}

function assertSafeSmallProjectId(smallProjectId: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(smallProjectId)) {
    throw new Error("smallProjectId may only contain letters, numbers, underscores, and hyphens.");
  }
}

function normalizePaths<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [
      key,
      typeof field === "string" ? normalizePath(field) : field,
    ]),
  ) as T;
}

function normalizePath(value: string): string {
  return value.replaceAll(path.sep, "/");
}
