import { runHtmlVideoWorkflow } from "../lib/video-html/html-video-workflow.ts";

const smallProjectId = process.argv[2]?.trim();
if (!smallProjectId) {
  console.error("Usage: pnpm workflow <small_project_id>");
  process.exit(1);
}

const result = await runHtmlVideoWorkflow(smallProjectId);
console.log(`html-video workflow complete: ${result.paths.finalMp4Path}`);
