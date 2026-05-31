import path from "node:path";
import {
  approvePreview,
  generateBeatLock,
  generateScenePlans,
  generateSectionMap,
  lockAcceptedMusic,
} from "../lib/post-minimax-workflow.ts";
import { runApprovedSceneToPreview } from "../lib/video-preview-workflow.ts";

const projectPath = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (!projectPath) {
  console.error("Usage: npm run workflow -- /absolute/path/to/project_projectid");
  process.exit(1);
}

await lockAcceptedMusic(projectPath);
await generateBeatLock(projectPath);
await generateSectionMap(projectPath);
await generateScenePlans(projectPath);
await runApprovedSceneToPreview(projectPath, "cli");
await approvePreview(projectPath, "cli");
console.log(`Post-MiniMax workflow complete: ${projectPath}`);
