import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type RevisionScope = { type: "project" } | { type: "scene"; scene_id: string };
export type RevisionStatus = "pending" | "succeeded" | "failed";

export type RevisionRequestFile = {
  schema_version: 1;
  revision_id: string;
  small_project_id: string;
  scope: RevisionScope;
  request: string;
  created_at: string;
  created_by: string;
  status: RevisionStatus;
};

export function createRevisionRequest(input: {
  smallProjectId: string;
  body: unknown;
  createdAt?: string;
  createdBy?: string;
}): RevisionRequestFile {
  const body = isRecord(input.body) ? input.body : null;
  if (!body) throw new Error("revision request body must be a JSON object");
  if (Array.isArray(body.requests)) throw new Error("revision accepts exactly one natural-language request per API call");
  const request = stringValue(body.request);
  if (!request) throw new Error("revision request is required");
  if (request.split(/\n\s*\n/).filter((part) => part.trim().length > 0).length > 1) {
    throw new Error("revision accepts exactly one natural-language request per API call");
  }
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    schema_version: 1,
    revision_id: revisionId(createdAt),
    small_project_id: input.smallProjectId,
    scope: revisionScope(body.scope),
    request,
    created_at: createdAt,
    created_by: input.createdBy ?? stringValue(body.created_by) ?? stringValue(body.createdBy) ?? "local-user",
    status: "pending",
  };
}

export function withRevisionStatus(revision: RevisionRequestFile, status: RevisionStatus): RevisionRequestFile {
  return { ...revision, status };
}

export async function writeRevisionRequest(input: {
  projectRoot: string;
  revision: RevisionRequestFile;
}): Promise<{ revision: RevisionRequestFile; path: string }> {
  const relativePath = "revision_request.json";
  await mkdir(input.projectRoot, { recursive: true });
  await writeFile(path.join(input.projectRoot, relativePath), `${JSON.stringify(input.revision, null, 2)}\n`, "utf8");
  return { revision: input.revision, path: relativePath };
}

export async function readRevisionRequest(projectRoot: string): Promise<RevisionRequestFile | null> {
  try {
    return JSON.parse(await readFile(path.join(projectRoot, "revision_request.json"), "utf8")) as RevisionRequestFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function revisionScope(value: unknown): RevisionScope {
  if (!isRecord(value)) return { type: "project" };
  if (value.type === "project") return { type: "project" };
  if (value.type === "scene") {
    const sceneId = stringValue(value.scene_id) ?? stringValue(value.sceneId);
    if (!sceneId) throw new Error("scene revision scope requires scene_id");
    if (!/^[a-zA-Z0-9_.-]+$/.test(sceneId)) throw new Error("scene_id contains unsupported characters");
    return { type: "scene", scene_id: sceneId };
  }
  throw new Error("revision scope type must be project or scene");
}

function revisionId(createdAt: string): string {
  return `revision_${createdAt.replaceAll(/[^0-9A-Za-z]+/g, "_").replaceAll(/^_+|_+$/g, "")}`;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
