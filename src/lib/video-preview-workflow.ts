import { writeArtifactSnapshot } from "./artifact-catalog.ts";
import { resolveHypeframesAgentMode } from "./hypeframes-agent-mode.ts";
import { runHypeframesCodexAgent } from "./hypeframes-codex-agent.ts";
import { runHypeframesFileGate } from "./hypeframes-file-gate.ts";
import { approveScenePlan, generateHypeframesProject, renderPreview } from "./post-minimax-workflow.ts";

export async function runApprovedSceneToPreview(projectPath: string, reviewer = "human"): Promise<void> {
  await approveScenePlan(projectPath, reviewer);
  await generateHypeframesProject(projectPath);
  await runHypeframesFileGate(projectPath);

  if (shouldRunWslCodexAgent()) {
    await runHypeframesCodexAgent(projectPath);
  }

  await runHypeframesFileGate(projectPath);
  await renderPreview(projectPath);
  await writeArtifactSnapshot(projectPath);
}

export function shouldRunWslCodexAgent(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveHypeframesAgentMode(env) !== "off";
}
