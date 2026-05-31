import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export type ProjectFileSnapshot = {
  projectPath: string;
  created_at: string;
  files: Array<{
    relativePath: string;
    exists: boolean;
    sizeBytes: number | null;
    sha256: string | null;
  }>;
};

export async function snapshotProjectFiles(input: {
  projectPath: string;
  include: string[];
}): Promise<ProjectFileSnapshot> {
  const files = new Map<string, ProjectFileSnapshot["files"][number]>();
  for (const pattern of input.include) {
    if (pattern.endsWith("/**")) {
      const root = pattern.slice(0, -3);
      for (const relativePath of await listFiles(input.projectPath, root)) {
        files.set(relativePath, await snapshotOne(input.projectPath, relativePath));
      }
    } else {
      files.set(pattern, await snapshotOne(input.projectPath, pattern));
    }
  }
  return {
    projectPath: input.projectPath,
    created_at: new Date().toISOString(),
    files: [...files.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
  };
}

export function diffProjectFileSnapshots(
  before: ProjectFileSnapshot,
  after: ProjectFileSnapshot,
): {
  added: string[];
  modified: string[];
  deleted: string[];
} {
  const beforeMap = new Map(before.files.map((file) => [file.relativePath, file]));
  const afterMap = new Map(after.files.map((file) => [file.relativePath, file]));
  const allPaths = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const relativePath of [...allPaths].sort()) {
    const left = beforeMap.get(relativePath);
    const right = afterMap.get(relativePath);
    if (!left?.exists && right?.exists) {
      added.push(relativePath);
    } else if (left?.exists && !right?.exists) {
      deleted.push(relativePath);
    } else if (left?.exists && right?.exists && left.sha256 !== right.sha256) {
      modified.push(relativePath);
    }
  }
  return { added, modified, deleted };
}

async function snapshotOne(projectPath: string, relativePath: string): Promise<ProjectFileSnapshot["files"][number]> {
  const filePath = path.join(projectPath, relativePath);
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return { relativePath, exists: false, sizeBytes: null, sha256: null };
    }
    return {
      relativePath,
      exists: true,
      sizeBytes: fileStat.size,
      sha256: createHash("sha256").update(await readFile(filePath)).digest("hex"),
    };
  } catch {
    return { relativePath, exists: false, sizeBytes: null, sha256: null };
  }
}

async function listFiles(projectPath: string, relativeRoot: string): Promise<string[]> {
  const rootPath = path.join(projectPath, relativeRoot);
  const files: string[] = [];
  try {
    const entries = await readdir(rootPath, { withFileTypes: true });
    for (const entry of entries) {
      const childRelative = path.posix.join(relativeRoot, entry.name);
      if (entry.isDirectory()) {
        files.push(...await listFiles(projectPath, childRelative));
      } else if (entry.isFile()) {
        files.push(childRelative);
      }
    }
  } catch {
    return [];
  }
  return files;
}
