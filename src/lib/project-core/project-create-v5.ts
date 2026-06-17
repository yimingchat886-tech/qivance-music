import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { QivancePrismaClient } from "../db/prisma-client.ts";
import { createControlPlaneId } from "../db/control-plane.ts";
import { requireEnabledV5Chain, type V5ChainId } from "../chain-registry/chain-registry.ts";

export type V5CreateProjectInput = {
  storageRoot: string;
  title: string;
  contentType: string;
  description?: string | null;
  projectId?: string;
};

export type V5CreatedProject = {
  project_id: string;
  status: "input_required";
  chain_id: V5ChainId;
  project_root: string;
};

export async function createV5Project(
  prisma: QivancePrismaClient,
  input: V5CreateProjectInput,
): Promise<V5CreatedProject> {
  const title = input.title.trim();
  if (!title) throw new Error("title is required.");
  const chain = requireEnabledV5Chain(input.contentType);
  const projectId = input.projectId ?? createControlPlaneId("project");
  assertSafeV5ProjectId(projectId);
  const projectRoot = normalizePath(path.join(path.resolve(input.storageRoot), projectId));

  await mkdir(projectRoot, { recursive: true });
  await Promise.all([
    mkdir(path.join(projectRoot, "inputs", "lyrics"), { recursive: true }),
    mkdir(path.join(projectRoot, "inputs", "audio"), { recursive: true }),
    mkdir(path.join(projectRoot, "inputs", "video"), { recursive: true }),
    mkdir(path.join(projectRoot, "data", "source"), { recursive: true }),
    mkdir(path.join(projectRoot, "data", "timing"), { recursive: true }),
    mkdir(path.join(projectRoot, "data", "chains", chain.chain_id), { recursive: true }),
    mkdir(path.join(projectRoot, "exports", chain.chain_id), { recursive: true }),
    mkdir(path.join(projectRoot, "video", "html-video"), { recursive: true }),
  ]);

  await prisma.project.create({
    data: {
      id: projectId,
      title,
      description: input.description?.trim() || null,
      contentType: chain.chain_id,
      status: "input_required",
      projectRoot,
      chains: {
        create: {
          id: createControlPlaneId("chain"),
          chainId: chain.chain_id,
          status: "input_required",
        },
      },
    },
  });

  return {
    project_id: projectId,
    status: "input_required",
    chain_id: chain.chain_id,
    project_root: projectRoot,
  };
}

export function assertSafeV5ProjectId(projectId: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw new Error("projectId may only contain letters, numbers, underscores, and hyphens.");
  }
}

function normalizePath(value: string): string {
  return value.replaceAll(path.sep, "/");
}
