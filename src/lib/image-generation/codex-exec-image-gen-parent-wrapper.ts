import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ImageGenerationRequest, ImageGenerationResult } from "./types.ts";
import { parseImageGenerationRequest } from "./codex-exec-image-gen-wrapper.ts";
import { sha256File } from "../fs-utils.ts";

export type ParentImageGenRunner = (input: {
  command: string;
  args: string[];
  stdin: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}) => Promise<{ stdout: string; stderr: string; exitCode: number; timedOut?: boolean }>;

export type ParentWrapperOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  codexCommand?: string;
  runner?: ParentImageGenRunner;
  generatedImagesRoot?: string;
  jobId?: string;
  timeoutMs?: number;
};

type PngSnapshot = Map<string, number>;

export { parseImageGenerationRequest };

export async function generateImageCandidatesViaParentWrapper(
  request: ImageGenerationRequest,
  options: ParentWrapperOptions = {},
): Promise<ImageGenerationResult> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const codexCommand = options.codexCommand ?? env.QIVANCE_CODEX_EXEC_CMD ?? "codex";
  const runner = options.runner ?? runCodexExecWithTimeout;
  const timeoutMs = options.timeoutMs ?? parseTimeoutMs(env.QIVANCE_CODEX_IMAGE_GEN_TIMEOUT_MS) ?? 5 * 60 * 1000;
  const outputDir = path.resolve(request.outputDir);
  const jobId = options.jobId ?? `${request.requestId}-${randomUUID()}`;
  const jobDir = path.join(outputDir, ".codex-imagegen-smoke", jobId);
  const finalMessagePath = path.join(jobDir, "final-message.txt");
  const generatedRoots = await resolveGeneratedImageRoots({ env, explicitRoot: options.generatedImagesRoot });

  await mkdir(jobDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const before = await snapshotPngFiles(generatedRoots);
  const startedAt = Date.now();
  const child = await runner({
    command: codexCommand,
    args: [
      "exec",
      "--ignore-user-config",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "--cd",
      cwd,
      "--output-last-message",
      finalMessagePath,
      "-",
    ],
    stdin: buildChildPrompt(request),
    cwd,
    env,
    timeoutMs,
  });

  if (child.exitCode !== 0) {
    throw new Error(`codex exec image_gen failed with exit code ${child.exitCode}: ${diagnosticsForFailure({
      child,
      generatedRoots,
      outputDir,
      timeoutMs,
    })}`);
  }

  const discovered = await discoverNewGeneratedPngs({
    roots: generatedRoots,
    before,
    startedAt,
  });
  const selected = discovered.slice(0, request.variants);
  if (selected.length < request.variants) {
    throw new Error(`codex exec image_gen produced ${selected.length} PNG candidate(s), expected ${request.variants}: ${diagnosticsForFailure({
      child,
      generatedRoots,
      outputDir,
      timeoutMs,
    })}`);
  }

  const candidates = await Promise.all(selected.map(async (sourcePath, index) => {
    const outputPath = path.join(outputDir, `${request.requestId}_v${index + 1}.png`);
    await copyFile(sourcePath, outputPath);
    const absolutePath = await resolveCandidatePath(outputPath, outputDir);
    const dimensions = await readPngDimensions(absolutePath);
    return {
      candidateId: `${request.requestId}_v${index + 1}`,
      path: absolutePath,
      sha256: await sha256File(absolutePath),
      width: dimensions.width,
      height: dimensions.height,
      provenance: {
        command: codexCommand,
        mode: "codex_exec_imagegen_parent_wrapper",
        jobDir,
        sourcePath,
        generatedRoots,
        timeoutMs,
      },
    };
  }));

  return {
    requestId: request.requestId,
    adapterId: "codex_image_gen",
    status: "succeeded",
    candidates,
    diagnostics: finalMessageDiagnostics(await readFile(finalMessagePath, "utf8").catch(() => "")),
  };
}

function buildChildPrompt(request: ImageGenerationRequest): string {
  return [
    "You are a non-interactive image generation worker for qivance-music.",
    "Use the $imagegen skill and the built-in image_gen tool to generate raster image files.",
    "Only call image generation. Do not run shell commands. Do not inspect environment variables.",
    "Do not copy, move, rename, or post-process generated files.",
    "Do not modify source code or project metadata.",
    "",
    "Generate image candidates for this request:",
    JSON.stringify({
      requestId: request.requestId,
      sceneId: request.sceneId,
      assetRole: request.assetRole,
      prompt: request.prompt,
      aspectRatio: request.aspectRatio,
      targetSize: request.targetSize,
      variants: request.variants,
    }, null, 2),
    "",
    `Generate exactly ${request.variants} PNG background image candidate(s).`,
    "No text, no watermark, no logos unless the request explicitly asks for them.",
    "Final response can be short text only, for example: IMAGE_GEN_DONE.",
  ].join("\n");
}

async function resolveGeneratedImageRoots(input: {
  env: NodeJS.ProcessEnv;
  explicitRoot?: string;
}): Promise<string[]> {
  const roots = new Set<string>();
  if (input.explicitRoot) roots.add(path.resolve(input.explicitRoot));
  if (input.env.QIVANCE_CODEX_GENERATED_IMAGES_DIR) roots.add(path.resolve(input.env.QIVANCE_CODEX_GENERATED_IMAGES_DIR));
  for (const codexHome of possibleCodexHomes(input.env)) {
    roots.add(path.join(codexHome, "generated_images"));
  }

  const existing: string[] = [];
  for (const root of roots) {
    if (await isDirectory(root)) existing.push(await realpath(root));
  }
  if (existing.length === 0) {
    throw new Error(`No Codex generated_images directory found. Checked: ${Array.from(roots).join(", ")}`);
  }
  return existing;
}

function possibleCodexHomes(env: NodeJS.ProcessEnv): string[] {
  const homes: string[] = [];
  if (env.CODEX_HOME) homes.push(toWslPath(env.CODEX_HOME));
  homes.push(path.join(os.homedir(), ".codex"));
  const user = env.USER || path.basename(os.homedir());
  homes.push(path.join("/mnt/c/Users", user, ".codex"));
  homes.push(path.join("/mnt/c/Users", capitalize(user), ".codex"));
  return homes;
}

function toWslPath(value: string): string {
  const windowsMatch = value.match(/^([A-Za-z]):\\(.*)$/);
  if (!windowsMatch) return value;
  const drive = windowsMatch[1].toLowerCase();
  const rest = windowsMatch[2].replaceAll("\\", "/");
  return `/mnt/${drive}/${rest}`;
}

function capitalize(value: string): string {
  return value ? `${value.slice(0, 1).toUpperCase()}${value.slice(1)}` : value;
}

async function snapshotPngFiles(roots: string[]): Promise<PngSnapshot> {
  const snapshot: PngSnapshot = new Map();
  for (const root of roots) {
    for (const filePath of await listPngFiles(root)) {
      const fileStat = await stat(filePath);
      snapshot.set(filePath, fileStat.mtimeMs);
    }
  }
  return snapshot;
}

async function discoverNewGeneratedPngs(input: {
  roots: string[];
  before: PngSnapshot;
  startedAt: number;
}): Promise<string[]> {
  const candidates: Array<{ path: string; mtimeMs: number }> = [];
  for (const root of input.roots) {
    for (const filePath of await listPngFiles(root)) {
      const fileStat = await stat(filePath);
      const previousMtime = input.before.get(filePath);
      const isNew = previousMtime === undefined;
      const isModified = previousMtime !== undefined && fileStat.mtimeMs > previousMtime;
      if ((isNew || isModified) && fileStat.mtimeMs >= input.startedAt - 1000) {
        candidates.push({ path: filePath, mtimeMs: fileStat.mtimeMs });
      }
    }
  }
  return candidates
    .sort((left, right) => left.mtimeMs - right.mtimeMs || left.path.localeCompare(right.path))
    .map((candidate) => candidate.path);
}

async function listPngFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  await collectPngFiles(root, files, 0);
  return files;
}

async function collectPngFiles(dir: string, files: string[], depth: number): Promise<void> {
  if (depth > 2) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectPngFiles(entryPath, files, depth + 1);
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".png") {
      files.push(await realpath(entryPath));
    }
  }
}

async function resolveCandidatePath(candidatePath: string, outputDir: string): Promise<string> {
  const absolutePath = path.isAbsolute(candidatePath) ? candidatePath : path.resolve(outputDir, candidatePath);
  const [realOutputDir, realCandidatePath] = await Promise.all([
    realpath(outputDir),
    realpath(absolutePath),
  ]);
  if (!isInsideDirectory(realCandidatePath, realOutputDir)) {
    throw new Error(`codex exec image_gen candidate is outside outputDir: ${candidatePath}`);
  }
  if (path.extname(realCandidatePath).toLowerCase() !== ".png") {
    throw new Error(`codex exec image_gen candidate must be a PNG file: ${candidatePath}`);
  }
  return realCandidatePath;
}

function isInsideDirectory(childPath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readPngDimensions(filePath: string): Promise<{ width: number; height: number }> {
  const bytes = await readFile(filePath);
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || bytes.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error(`codex exec image_gen candidate is not a readable PNG: ${filePath}`);
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

async function runCodexExecWithTimeout(input: {
  command: string;
  args: string[];
  stdin: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut?: boolean }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, input.timeoutMs);
    timeout.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      if (timedOut) {
        resolve({ stdout, stderr, exitCode: 124, timedOut: true });
        return;
      }
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });
    child.stdin.end(input.stdin);
  });
}

function parseTimeoutMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1000) throw new Error("QIVANCE_CODEX_IMAGE_GEN_TIMEOUT_MS must be at least 1000");
  return parsed;
}

function diagnosticsForFailure(input: {
  child: { stdout: string; stderr: string; exitCode: number; timedOut?: boolean };
  generatedRoots: string[];
  outputDir: string;
  timeoutMs: number;
}): string {
  return JSON.stringify({
    timedOut: Boolean(input.child.timedOut),
    timeoutMs: input.timeoutMs,
    outputDir: input.outputDir,
    generatedRoots: input.generatedRoots,
    stderr: trimForError(input.child.stderr),
    stdout: trimForError(input.child.stdout),
  });
}

function finalMessageDiagnostics(value: string): string[] {
  const trimmed = value.trim();
  return trimmed ? [`child_final_message: ${trimForError(trimmed)}`] : [];
}

function trimForError(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 600 ? `${trimmed.slice(0, 600)}...` : trimmed;
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}
