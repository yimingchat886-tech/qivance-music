import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export type HyperframesSkillsResourceFile = {
  relativePath: string;
  content: string;
  sha256: string;
};

export type HyperframesSkillsResource = {
  name: string;
  version: string;
  source: string;
  hash: string;
  files: HyperframesSkillsResourceFile[];
};

type HyperframesSkillsManifest = {
  name?: unknown;
  version?: unknown;
  source?: unknown;
  files?: unknown;
};

const resourceRoot = new URL("../../resources/hyperframes-skills/v1/", import.meta.url);
export function validateHyperframesSkillsResourcePath(relativePath: string): URL {
  let decoded = "";
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    decoded = relativePath;
  }
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(relativePath) ||
    decoded.split("/").includes("..")
  ) {
    throw new Error(`Invalid HyperFrames skills resource path: ${relativePath}`);
  }
  const resolved = new URL(relativePath, resourceRoot);
  if (!resolved.href.startsWith(resourceRoot.href)) {
    throw new Error(`Invalid HyperFrames skills resource path: ${relativePath}`);
  }
  return resolved;
}


export async function loadHyperframesSkillsResource(): Promise<HyperframesSkillsResource> {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", resourceRoot), "utf8")) as HyperframesSkillsManifest;
  if (typeof manifest.name !== "string" || typeof manifest.version !== "string" || typeof manifest.source !== "string") {
    throw new Error("HyperFrames skills manifest must include string name, version, and source.");
  }
  if (!Array.isArray(manifest.files) || !manifest.files.every((item): item is string => typeof item === "string")) {
    throw new Error("HyperFrames skills manifest files must be a string array.");
  }

  const files = await Promise.all(
    manifest.files.map(async (relativePath) => {
      const content = await readFile(validateHyperframesSkillsResourcePath(relativePath), "utf8");
      return {
        relativePath,
        content,
        sha256: sha256(content),
      };
    }),
  );
  const sorted = files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return {
    name: manifest.name,
    version: manifest.version,
    source: manifest.source,
    hash: sha256(sorted.map((file) => `${file.relativePath}\n${file.sha256}`).join("\n")),
    files: sorted,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
