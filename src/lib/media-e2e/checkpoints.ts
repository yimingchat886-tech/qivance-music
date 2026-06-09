import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type MediaE2EStepStatus = "passed" | "failed";

export type MediaE2EStepCheckpoint = {
  step: string;
  status: MediaE2EStepStatus;
  inputs: string[];
  outputs: string[];
  diagnostics: string[];
  startedAt: string;
  completedAt: string;
};

export async function writeStepCheckpoint(
  projectRoot: string,
  checkpoint: Omit<MediaE2EStepCheckpoint, "startedAt" | "completedAt"> &
    Partial<Pick<MediaE2EStepCheckpoint, "startedAt" | "completedAt">>,
): Promise<void> {
  const dir = path.join(projectRoot, "logs", "media-e2e", "checkpoints");
  const now = new Date().toISOString();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${checkpoint.step}.json`), `${JSON.stringify({
    ...checkpoint,
    startedAt: checkpoint.startedAt ?? now,
    completedAt: checkpoint.completedAt ?? now,
  }, null, 2)}\n`, "utf8");
}

export async function readStepCheckpoint(projectRoot: string, step: string): Promise<MediaE2EStepCheckpoint | null> {
  try {
    return JSON.parse(
      await readFile(path.join(projectRoot, "logs", "media-e2e", "checkpoints", `${step}.json`), "utf8"),
    ) as MediaE2EStepCheckpoint;
  } catch {
    return null;
  }
}
