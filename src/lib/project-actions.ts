import { rm } from "node:fs/promises";
import { importStoryboardFromJson, type StoryboardImportResult } from "./storyboard-import.ts";
import {
  startHyperframesUi,
  type HyperframesCommand,
  type HyperframesUiRuntime,
} from "./hyperframes-ui.ts";

export async function importPastedStoryboard(
  projectPath: string,
  body: Buffer,
): Promise<StoryboardImportResult> {
  const params = new URLSearchParams(body.toString("utf8"));
  const storyboardJson = params.get("storyboardJson")?.trim();
  if (!storyboardJson) {
    throw new Error("Missing storyboardJson.");
  }
  return importStoryboardFromJson({ projectPath, storyboardJson });
}

export async function deleteProject(projectPath: string): Promise<void> {
  await rm(projectPath, { recursive: true, force: true });
}

export async function startProjectHyperframesUi(input: {
  projectPath: string;
  projectId: string;
  requestHost?: string;
  command?: HyperframesCommand;
  findFreePort?: () => Promise<number>;
}): Promise<HyperframesUiRuntime> {
  return startHyperframesUi(input);
}
