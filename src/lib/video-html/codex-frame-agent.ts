import { mkdir, writeFile } from "node:fs/promises";
import type { SmallProjectPaths } from "../project-core/paths.ts";
import { buildCodexFrameAgentPrompt } from "./codex-frame-agent-prompt.ts";
import { assertAllowedPathChanges, diffSnapshots, snapshotFiles } from "./path-gate.ts";
import { runCodexExec, type CodexExecResult } from "./codex-runner.ts";

export type CodexExecutor = (input: { cwd: string; prompt: string }) => Promise<CodexExecResult>;

export async function runCodexFrameAgent(input: {
  paths: SmallProjectPaths;
  executor?: CodexExecutor;
}): Promise<CodexExecResult & { changedFiles: string[] }> {
  await mkdir(input.paths.codexDir, { recursive: true });
  const prompt = buildCodexFrameAgentPrompt({
    smallProjectId: input.paths.smallProjectId,
    agentContextPath: "codex/agent_context.json",
    contentGraphPath: "content-graph.json",
    frameContractsPath: "qivance-frame-contracts.json",
  });
  await writeFile(input.paths.codexPromptPath, prompt, "utf8");
  const before = await snapshotFiles(input.paths.htmlVideoProjectDir);
  const result = await (input.executor ?? runCodexExec)({
    cwd: input.paths.htmlVideoProjectDir,
    prompt,
  });
  await writeFile(input.paths.codexResultPath, result.stdout, "utf8");
  const changedFiles = diffSnapshots(before, await snapshotFiles(input.paths.htmlVideoProjectDir));
  assertAllowedPathChanges(changedFiles);
  return { ...result, changedFiles };
}
