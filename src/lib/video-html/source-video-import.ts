import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { ffprobe, type MediaProbe } from "../export/ffprobe.ts";
import { sha256File, writeJson } from "../fs-utils.ts";

export type SourceVideoImportFile = {
  schema_version: 1;
  small_project_id: string;
  source_video: {
    path: string;
    sha256: string;
    duration_sec: number;
    width: number;
    height: number;
    video_codec: string;
    audio_streams: number;
    audio_codec: string;
    ffprobe: MediaProbe;
  };
  audio_policy: "preserve_source_audio" | "background_video_only";
  status: "locked";
  provenance: {
    source: "local_file";
    imported_at: string;
  };
};

export type SourceVideoImportProbe = (filePath: string) => Promise<MediaProbe>;

export async function importSourceVideoAsset(input: {
  projectRoot: string;
  smallProjectId: string;
  sourcePath?: string;
  copyToProject?: boolean;
  destinationPath?: string;
  audioPolicy?: SourceVideoImportFile["audio_policy"];
  importedAt?: string;
  probe?: SourceVideoImportProbe;
}): Promise<{ importFile: SourceVideoImportFile; path: string }> {
  const sourcePath = input.sourcePath?.trim() || "source_video.mp4";
  if (isRemoteSource(sourcePath)) throw new Error("Remote URL source video imports are forbidden in production.");
  const resolved = await resolveSourceVideoPath({
    projectRoot: input.projectRoot,
    sourcePath,
    copyToProject: input.copyToProject ?? true,
    destinationPath: input.destinationPath ?? "source_video.mp4",
  });
  const probe = await (input.probe ?? ffprobe)(resolved.absolutePath);
  const audioPolicy = input.audioPolicy ?? "preserve_source_audio";
  assertUsableSourceVideoProbe(probe, audioPolicy);
  const importFile: SourceVideoImportFile = {
    schema_version: 1,
    small_project_id: input.smallProjectId,
    source_video: {
      path: resolved.relativePath,
      sha256: await sha256File(resolved.absolutePath),
      duration_sec: probe.durationSec,
      width: probe.video?.width ?? 0,
      height: probe.video?.height ?? 0,
      video_codec: probe.video?.codecName ?? "",
      audio_streams: probe.audioStreamCount,
      audio_codec: probe.audio?.codecName ?? "",
      ffprobe: probe,
    },
    audio_policy: audioPolicy,
    status: "locked",
    provenance: {
      source: "local_file",
      imported_at: input.importedAt ?? new Date().toISOString(),
    },
  };
  const relativePath = "data/source/source_video_import.json";
  await writeJson(path.join(input.projectRoot, relativePath), importFile);
  return { importFile, path: relativePath };
}

export function sourceVideoAgentContext(importFile: SourceVideoImportFile) {
  return {
    enabled: true as const,
    status: "locked" as const,
    path: importFile.source_video.path,
    sha256: importFile.source_video.sha256,
    audioPolicy: importFile.audio_policy,
  };
}

function assertUsableSourceVideoProbe(probe: MediaProbe, audioPolicy: SourceVideoImportFile["audio_policy"]): void {
  if (!probe.hasVideoStream || !probe.video || probe.video.width <= 0 || probe.video.height <= 0 || !probe.video.codecName) {
    throw new Error("Source video import requires a readable MP4 with one video stream and dimensions.");
  }
  if (audioPolicy === "preserve_source_audio" && (!probe.hasAudioStream || probe.audioStreamCount <= 0 || !probe.audio?.codecName)) {
    throw new Error("Source video import requires an audio stream so source audio can be preserved.");
  }
  if (!Number.isFinite(probe.durationSec) || probe.durationSec <= 0) {
    throw new Error("Source video import requires a positive duration.");
  }
}

async function resolveSourceVideoPath(input: {
  projectRoot: string;
  sourcePath: string;
  copyToProject: boolean;
  destinationPath: string;
}): Promise<{ absolutePath: string; relativePath: string }> {
  if (path.extname(input.sourcePath).toLowerCase() !== ".mp4") {
    throw new Error("Source video import accepts MP4 files only.");
  }
  const projectRoot = path.resolve(input.projectRoot);
  const sourceAbsolutePath = path.isAbsolute(input.sourcePath)
    ? path.resolve(input.sourcePath)
    : path.resolve(projectRoot, input.sourcePath);
  await assertReadableFile(sourceAbsolutePath);

  if (isInsideDirectory(sourceAbsolutePath, projectRoot)) {
    return {
      absolutePath: sourceAbsolutePath,
      relativePath: normalizePath(path.relative(projectRoot, sourceAbsolutePath)),
    };
  }

  if (!input.copyToProject) {
    throw new Error("Source video import requires files outside the project root to be copied into the project.");
  }
  const destinationRelativePath = safeProjectRelativePath(input.destinationPath);
  if (path.extname(destinationRelativePath).toLowerCase() !== ".mp4") {
    throw new Error("Copied source video destination must be an MP4 path.");
  }
  const destinationAbsolutePath = path.resolve(projectRoot, destinationRelativePath);
  await mkdir(path.dirname(destinationAbsolutePath), { recursive: true });
  await copyFile(sourceAbsolutePath, destinationAbsolutePath);
  return {
    absolutePath: destinationAbsolutePath,
    relativePath: normalizePath(destinationRelativePath),
  };
}

async function assertReadableFile(filePath: string): Promise<void> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("Source video import path must reference a readable file.");
}

function safeProjectRelativePath(value: string): string {
  if (path.isAbsolute(value) || value.split(/[\\/]+/).includes("..")) {
    throw new Error("Source video destination must be project-relative.");
  }
  return normalizePath(path.normalize(value));
}

function isRemoteSource(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith("//");
}

function isInsideDirectory(filePath: string, directory: string): boolean {
  return filePath === directory || filePath.startsWith(directory + path.sep);
}

function normalizePath(value: string): string {
  return value.replaceAll(path.sep, "/");
}
