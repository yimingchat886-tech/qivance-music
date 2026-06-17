import type { V5ChainInputKind } from "../chain-registry/chain-registry.ts";

export type LockedInputSnapshotEntry = {
  id: string;
  kind: V5ChainInputKind;
  sha256: string;
  path: string;
  stable_path: string;
};

export type LockedInputSnapshot = {
  schema_version: 1;
  inputs: LockedInputSnapshotEntry[];
};

export function buildLockedInputSnapshot(inputs: Array<{
  id: string;
  kind: string;
  sha256: string;
  path: string;
  stablePath: string;
}>): LockedInputSnapshot {
  return {
    schema_version: 1,
    inputs: inputs.map((input) => ({
      id: input.id,
      kind: inputKind(input.kind),
      sha256: input.sha256,
      path: input.path,
      stable_path: input.stablePath,
    })),
  };
}

export function serializeLockedInputSnapshot(snapshot: LockedInputSnapshot): string {
  return JSON.stringify(snapshot);
}

export function parseLockedInputSnapshot(value: string | null | undefined): LockedInputSnapshot {
  if (!value) throw new Error("artifact_inconsistent: run is missing locked input snapshot.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("artifact_inconsistent: run locked input snapshot is invalid JSON.");
  }
  if (!isRecord(parsed) || parsed.schema_version !== 1 || !Array.isArray(parsed.inputs)) {
    throw new Error("artifact_inconsistent: run locked input snapshot is invalid.");
  }
  return {
    schema_version: 1,
    inputs: parsed.inputs.map((entry) => {
      if (!isRecord(entry)) throw new Error("artifact_inconsistent: run locked input snapshot entry is invalid.");
      return {
        id: requiredString(entry.id, "id"),
        kind: inputKind(requiredString(entry.kind, "kind")),
        sha256: requiredString(entry.sha256, "sha256"),
        path: requiredString(entry.path, "path"),
        stable_path: requiredString(entry.stable_path, "stable_path"),
      };
    }),
  };
}

function inputKind(value: string): V5ChainInputKind {
  if (value === "lyrics" || value === "audio" || value === "video") return value;
  throw new Error(`artifact_inconsistent: unsupported locked input kind ${value}.`);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`artifact_inconsistent: locked input ${field} is required.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
