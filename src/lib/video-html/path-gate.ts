import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type FileSnapshot = Map<string, string>;

export class CodexForbiddenFileChangeError extends Error {
  code = "codex-forbidden-file-change" as const;
  changedFiles: string[];

  constructor(changedFiles: string[]) {
    super(`Codex changed forbidden files: ${changedFiles.join(", ")}`);
    this.changedFiles = changedFiles;
  }
}

export async function snapshotFiles(rootDir: string): Promise<FileSnapshot> {
  const snapshot: FileSnapshot = new Map();
  await walk(rootDir, rootDir, snapshot);
  return snapshot;
}

export function diffSnapshots(before: FileSnapshot, after: FileSnapshot): string[] {
  const changed = new Set<string>();
  for (const [file, hash] of after) {
    if (before.get(file) !== hash) changed.add(file);
  }
  for (const file of before.keys()) {
    if (!after.has(file)) changed.add(file);
  }
  return [...changed].sort();
}

export function assertAllowedPathChanges(changedFiles: string[]): void {
  const forbidden = changedFiles.filter((file) => !isAllowedCodexChange(file));
  if (forbidden.length > 0) {
    throw new CodexForbiddenFileChangeError(forbidden);
  }
}

function isAllowedCodexChange(relativePath: string): boolean {
  return (
    /^frames\/[^/]+\.html$/.test(relativePath) ||
    /^frames\/.+\/[^/]+\.html$/.test(relativePath) ||
    relativePath.startsWith("codex/") ||
    relativePath.startsWith("qa/")
  );
}

async function walk(rootDir: string, currentDir: string, snapshot: FileSnapshot): Promise<void> {
  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absolute = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await walk(rootDir, absolute, snapshot);
      continue;
    }
    if (!entry.isFile()) continue;
    const fileStat = await stat(absolute);
    const bytes = await readFile(absolute);
    const relative = path.relative(rootDir, absolute).replaceAll(path.sep, "/");
    const hash = createHash("sha256").update(bytes).update(String(fileStat.size)).digest("hex");
    snapshot.set(relative, hash);
  }
}
