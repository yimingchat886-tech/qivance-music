import { randomUUID } from "node:crypto";
import path from "node:path";
import type { QivancePrismaClient } from "./prisma-client.ts";

export const V5_PROJECT_STATUSES = [
  "draft",
  "input_required",
  "input_uploaded",
  "input_confirmed",
  "queued",
  "running",
  "stopping",
  "stopped",
  "blocked",
  "failed",
  "passed",
] as const;

export type V5ProjectStatus = (typeof V5_PROJECT_STATUSES)[number];

export type CreateControlPlaneProjectInput = {
  storageRoot: string;
  projectId?: string;
  title: string;
  description?: string | null;
  contentType: string;
  status?: V5ProjectStatus;
};

export function createControlPlaneId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export async function createControlPlaneProject(
  prisma: QivancePrismaClient,
  input: CreateControlPlaneProjectInput,
) {
  const projectId = input.projectId ?? createControlPlaneId("project");
  return prisma.project.create({
    data: {
      id: projectId,
      title: input.title,
      description: input.description ?? null,
      contentType: input.contentType,
      status: input.status ?? "input_required",
      projectRoot: normalizePath(path.join(path.resolve(input.storageRoot), projectId)),
    },
  });
}

export async function listControlPlaneProjects(prisma: QivancePrismaClient) {
  return prisma.project.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      chains: true,
      inputs: true,
      runs: true,
    },
  });
}

export async function readControlPlaneProject(prisma: QivancePrismaClient, projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    include: {
      chains: true,
      inputs: true,
      artifacts: true,
      runs: {
        include: {
          tasks: true,
          events: true,
        },
      },
    },
  });
}

export async function markCurrentArtifactsStale(prisma: QivancePrismaClient, projectId: string): Promise<number> {
  const result = await prisma.artifact.updateMany({
    where: {
      projectId,
      status: "current",
    },
    data: {
      status: "stale",
    },
  });
  return result.count;
}

function normalizePath(value: string): string {
  return value.replaceAll(path.sep, "/");
}
