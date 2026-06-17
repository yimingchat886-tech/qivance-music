import { createHash } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MultipartFile } from "../multipart-form.ts";
import { buildV5SchedulerTaskSeeds, requireEnabledV5Chain, type V5ChainInputKind } from "../chain-registry/chain-registry.ts";
import { createControlPlaneId, markCurrentArtifactsStale } from "../db/control-plane.ts";
import type { QivancePrismaClient } from "../db/prisma-client.ts";
import { importSourceVideoAsset } from "../video-html/source-video-import.ts";

const REPLACE_ALLOWED_PROJECT_STATUSES = new Set(["draft", "input_required", "input_uploaded", "stopped", "failed", "passed"]);
const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "stopping"]);

export type V5InputUpload = {
  lyricsText?: string;
  lyricsFile?: MultipartFile;
  audioFile?: MultipartFile;
  videoFile?: MultipartFile;
  replace?: boolean;
};

export async function uploadV5ProjectInputs(
  prisma: QivancePrismaClient,
  projectId: string,
  upload: V5InputUpload,
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { inputs: true },
  });
  if (!project) throw new Error(`Missing V5 project: ${projectId}`);

  const requestedInputs = normalizeRequestedInputs(upload);
  if (requestedInputs.length === 0) {
    throw new Error("Upload requires lyrics_text, lyrics_file, audio_file, or video_file.");
  }

  const activeByKind = new Map(project.inputs.filter((input) => input.status === "active").map((input) => [input.kind, input]));
  const replacesExisting = requestedInputs.some((input) => activeByKind.has(input.kind));
  if (replacesExisting && !upload.replace) {
    throw new Error("Existing active inputs require replace=true.");
  }
  if (upload.replace && !REPLACE_ALLOWED_PROJECT_STATUSES.has(project.status)) {
    throw new Error(`Cannot replace inputs while project status is ${project.status}.`);
  }

  if (upload.replace) {
    await prisma.projectInput.updateMany({
      where: {
        projectId,
        kind: { in: requestedInputs.map((input) => input.kind) },
        status: "active",
      },
      data: { status: "superseded" },
    });
    if (replacesExisting) await markCurrentArtifactsStale(prisma, projectId);
  }

  const createdInputs = [];
  for (const input of requestedInputs) {
    const absolutePath = path.join(project.projectRoot, input.relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, input.data);
    createdInputs.push(await prisma.projectInput.create({
      data: {
        id: createControlPlaneId("input"),
        projectId,
        kind: input.kind,
        status: "active",
        originalName: input.originalName,
        path: input.relativePath,
        stablePath: stablePathForInputKind(input.kind),
        sha256: sha256Buffer(input.data),
        mime: input.mime,
      },
    }));
  }

  const activeInputs = await prisma.projectInput.findMany({
    where: {
      projectId,
      status: "active",
    },
  });
  const chain = requireEnabledV5Chain(project.contentType);
  const activeKinds = new Set(activeInputs.map((input) => input.kind));
  const nextStatus = chain.input_requirements.every((kind) => activeKinds.has(kind)) ? "input_uploaded" : "input_required";
  await prisma.project.update({
    where: { id: projectId },
    data: { status: nextStatus },
  });
  await prisma.chain.updateMany({
    where: { projectId },
    data: { status: nextStatus },
  });

  return {
    project_id: projectId,
    status: nextStatus,
    inputs: createdInputs.map((input) => inputResponse(input)),
  };
}

export async function confirmV5ProjectInputs(prisma: QivancePrismaClient, projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      inputs: true,
      chains: true,
      runs: true,
    },
  });
  if (!project) throw new Error(`Missing V5 project: ${projectId}`);
  if (project.runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status))) {
    throw new Error("Cannot confirm inputs while a queued, running, or stopping run exists.");
  }

  const activeLyrics = project.inputs.find((input) => input.kind === "lyrics" && input.status === "active");
  const activeAudio = project.inputs.find((input) => input.kind === "audio" && input.status === "active");
  const activeVideo = project.inputs.find((input) => input.kind === "video" && input.status === "active");
  const chain = project.chains.find((item) => item.chainId === project.contentType);
  if (!chain) throw new Error(`Missing ${project.contentType} chain.`);
  const registryEntry = requireEnabledV5Chain(chain.chainId);
  const activeByKind = new Map(project.inputs.filter((input) => input.status === "active").map((input) => [input.kind, input]));
  const missingInputs = registryEntry.input_requirements.filter((kind) => !activeByKind.has(kind));
  if (missingInputs.length > 0) {
    throw new Error(`Confirm inputs requires active ${humanInputList(registryEntry.input_requirements)}.`);
  }

  if (activeLyrics) await copyFile(path.join(project.projectRoot, activeLyrics.path), path.join(project.projectRoot, activeLyrics.stablePath));
  if (activeAudio) await copyFile(path.join(project.projectRoot, activeAudio.path), path.join(project.projectRoot, activeAudio.stablePath));
  if (activeVideo) {
    await copyFile(path.join(project.projectRoot, activeVideo.path), path.join(project.projectRoot, activeVideo.stablePath));
    await importSourceVideoAsset({
      projectRoot: project.projectRoot,
      smallProjectId: project.id,
      sourcePath: activeVideo.stablePath,
      copyToProject: false,
      audioPolicy: "background_video_only",
    });
  }

  const runId = createControlPlaneId("run");
  const taskSeeds = buildV5SchedulerTaskSeeds(chain.chainId);
  await prisma.schedulerRun.create({
    data: {
      id: runId,
      projectId,
      status: "queued",
      mode: "production",
      priority: 50,
      tasks: {
        create: taskSeeds.map((seed) => ({
          id: `${runId}_${seed.stage}`,
          projectId,
          chainId: chain.chainId,
          stage: seed.stage,
          status: "queued",
          dependenciesJson: JSON.stringify(seed.dependencies.map((dependency) => `${runId}_${dependency}`)),
          resourceRequirementsJson: JSON.stringify(seed.resource_requirements),
          inputArtifactsJson: JSON.stringify([]),
          outputArtifactsJson: JSON.stringify(seed.output_artifacts),
        })),
      },
      events: {
        create: {
          id: createControlPlaneId("event"),
          eventType: "run_created",
          message: "V5 scheduler run created from confirmed inputs.",
          detailsJson: JSON.stringify({
            locked_inputs: {
              lyrics: activeLyrics?.id,
              audio: activeAudio?.id,
              video: activeVideo?.id,
            },
          }),
        },
      },
    },
  });
  await prisma.project.update({
    where: { id: projectId },
    data: { status: "queued" },
  });
  await prisma.chain.updateMany({
    where: { projectId, chainId: chain.chainId },
    data: { status: "queued" },
  });

  return {
    project_id: projectId,
    status: "queued",
    run_id: runId,
    task_count: taskSeeds.length,
  };
}

function normalizeRequestedInputs(upload: V5InputUpload): Array<{
  kind: V5ChainInputKind;
  originalName: string;
  relativePath: string;
  data: Buffer;
  mime: string;
}> {
  const timestamp = new Date().toISOString().replaceAll(/[^0-9]+/g, "").slice(0, 14);
  const inputs = [];
  if (upload.lyricsText !== undefined && upload.lyricsText.trim().length > 0) {
    inputs.push({
      kind: "lyrics" as const,
      originalName: "lyrics.md",
      relativePath: `inputs/lyrics/lyrics_${timestamp}.md`,
      data: Buffer.from(upload.lyricsText, "utf8"),
      mime: "text/markdown",
    });
  }
  if (upload.lyricsFile) {
    const extension = safeLyricsExtension(upload.lyricsFile.filename);
    inputs.push({
      kind: "lyrics" as const,
      originalName: upload.lyricsFile.filename,
      relativePath: `inputs/lyrics/lyrics_${timestamp}${extension}`,
      data: nonEmptyFile(upload.lyricsFile, "lyrics_file").data,
      mime: upload.lyricsFile.mimeType || mimeForLyricsExtension(extension),
    });
  }
  if (upload.audioFile) {
    const extension = safeAudioExtension(upload.audioFile.filename);
    inputs.push({
      kind: "audio" as const,
      originalName: upload.audioFile.filename,
      relativePath: `inputs/audio/active_music_take_${timestamp}${extension}`,
      data: nonEmptyFile(upload.audioFile, "audio_file").data,
      mime: upload.audioFile.mimeType || mimeForAudioExtension(extension),
    });
  }
  if (upload.videoFile) {
    const extension = safeVideoExtension(upload.videoFile.filename);
    inputs.push({
      kind: "video" as const,
      originalName: upload.videoFile.filename,
      relativePath: `inputs/video/source_video_${timestamp}${extension}`,
      data: nonEmptyFile(upload.videoFile, "video_file").data,
      mime: upload.videoFile.mimeType || "video/mp4",
    });
  }
  return inputs;
}

function nonEmptyFile(file: MultipartFile, label: string): MultipartFile {
  if (file.data.byteLength === 0) throw new Error(`${label} is empty.`);
  return file;
}

function safeLyricsExtension(filename: string): ".md" | ".txt" {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".md" || extension === ".txt") return extension;
  throw new Error("lyrics_file must be .md or .txt.");
}

function safeAudioExtension(filename: string): ".mp3" | ".wav" {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".mp3" || extension === ".wav") return extension;
  throw new Error("audio_file must be .mp3 or .wav.");
}

function safeVideoExtension(filename: string): ".mp4" {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".mp4") return extension;
  throw new Error("video_file must be .mp4.");
}

function mimeForLyricsExtension(extension: ".md" | ".txt"): string {
  return extension === ".md" ? "text/markdown" : "text/plain";
}

function mimeForAudioExtension(extension: ".mp3" | ".wav"): string {
  return extension === ".mp3" ? "audio/mpeg" : "audio/wav";
}

function stablePathForInputKind(kind: V5ChainInputKind): string {
  switch (kind) {
    case "lyrics":
      return "lyrics.md";
    case "audio":
      return "active_music_take.mp3";
    case "video":
      return "source_video.mp4";
  }
}

function humanInputList(kinds: V5ChainInputKind[]): string {
  if (kinds.length <= 2) return kinds.join(" and ");
  return `${kinds.slice(0, -1).join(", ")}, and ${kinds.at(-1)}`;
}

function sha256Buffer(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function inputResponse(input: {
  id: string;
  kind: string;
  status: string;
  originalName: string;
  path: string;
  stablePath: string;
  sha256: string;
  mime: string;
}) {
  return {
    id: input.id,
    kind: input.kind,
    status: input.status,
    original_name: input.originalName,
    path: input.path,
    stable_path: input.stablePath,
    sha256: input.sha256,
    mime: input.mime,
  };
}
