import path from "node:path";
import {
  approvePreview,
  approveScenePlan,
  generateBeatLock,
  generateHypeframesProject,
  generateScenePlans,
  generateSectionMap,
  lockAcceptedMusic,
  renderPreview,
} from "../lib/post-minimax-workflow.ts";

const projectPath = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (!projectPath) {
  console.error("Usage: npm run workflow -- /absolute/path/to/project_projectid");
  process.exit(1);
}

await lockAcceptedMusic(projectPath);
await generateBeatLock(projectPath);
await generateSectionMap(projectPath);
await generateScenePlans(projectPath);
await approveScenePlan(projectPath, "cli");
await generateHypeframesProject(projectPath);
await renderPreview(projectPath);
await approvePreview(projectPath, "cli");
console.log(`Post-MiniMax workflow complete: ${projectPath}`);
