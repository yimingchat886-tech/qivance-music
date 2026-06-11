import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImageGenerationRequest, ImageGenerationResult } from "./types.ts";
import { sha256File } from "../fs-utils.ts";

export type CodexExecImageGenRunner = (input: {
  command: string;
  args: string[];
  stdin: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export type CodexExecImageGenWrapperOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  codexCommand?: string;
  runner?: CodexExecImageGenRunner;
  jobId?: string;
};

type ChildImageGenResponse = {
  status: "succeeded" | "failed";
  candidatePaths: string[];
  diagnostics: string[];
};

export async function generateImageCandidatesViaCodexExec(
  request: ImageGenerationRequest,
  options: CodexExecImageGenWrapperOptions = {},
): Promise<ImageGenerationResult> {
  validateRequest(request);

  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const codexCommand = options.codexCommand ?? env.QIVANCE_CODEX_EXEC_CMD ?? "codex";
  const runner = options.runner ?? runCodexExec;
  const outputDir = path.resolve(request.outputDir);
  const jobId = options.jobId ?? `${request.requestId}-${randomUUID()}`;
  const jobDir = path.join(outputDir, ".codex-imagegen-smoke", jobId);
  const schemaPath = path.join(jobDir, "response.schema.json");
  const finalMessagePath = path.join(jobDir, "final-message.json");

  await mkdir(jobDir, { recursive: true });
  await writeFile(schemaPath, JSON.stringify(childResponseSchema(), null, 2), "utf8");

  const args = [
    "exec",
    "--sandbox",
    "workspace-write",
    "--skip-git-repo-check",
    "--cd",
    cwd,
    "--add-dir",
    outputDir,
    "--output-schema",
    schemaPath,
    "--output-last-message",
    finalMessagePath,
    "-",
  ];

  const child = await runner({
    command: codexCommand,
    args,
    stdin: buildChildPrompt(request, outputDir),
    cwd,
    env,
  });

  if (child.exitCode !== 0) {
    throw new Error(`codex exec image_gen smoke failed with exit code ${child.exitCode}: ${trimForError(child.stderr || child.stdout)}`);
  }

  const finalMessage = await readFile(finalMessagePath, "utf8").catch(() => "");
  if (!finalMessage.trim()) {
    throw new Error("codex exec image_gen smoke produced no final response");
  }

  const parsed = parseChildResponse(finalMessage);
  if (parsed.status !== "succeeded") {
    throw new Error(`codex exec image_gen smoke failed: ${parsed.diagnostics.join("; ") || "no diagnostics"}`);
  }
  if (parsed.candidatePaths.length < request.variants) {
    throw new Error(`codex exec image_gen smoke returned ${parsed.candidatePaths.length} candidate(s), expected ${request.variants}`);
  }

  const candidates = await Promise.all(parsed.candidatePaths.slice(0, request.variants).map(async (candidatePath, index) => {
    const absolutePath = await resolveCandidatePath(candidatePath, outputDir);
    const dimensions = await readPngDimensions(absolutePath);
    return {
      candidateId: `${request.requestId}_v${index + 1}`,
      path: absolutePath,
      sha256: await sha256File(absolutePath),
      width: dimensions.width,
      height: dimensions.height,
      provenance: {
        command: codexCommand,
        mode: "codex_exec_imagegen_smoke",
        jobDir,
      },
    };
  }));

  return {
    requestId: request.requestId,
    adapterId: "codex_image_gen",
    status: "succeeded",
    candidates,
    diagnostics: parsed.diagnostics,
  };
}

export function parseImageGenerationRequest(raw: string): ImageGenerationRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid ImageGenerationRequest JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  validateRequest(parsed);
  return parsed;
}

function validateRequest(value: unknown): asserts value is ImageGenerationRequest {
  if (!value || typeof value !== "object") throw new Error("ImageGenerationRequest must be an object");
  const request = value as Record<string, unknown>;
  for (const field of ["requestId", "sceneId", "prompt", "outputDir"]) {
    if (typeof request[field] !== "string" || !request[field]) throw new Error(`ImageGenerationRequest.${field} must be a non-empty string`);
  }
  if (request.assetRole !== "background") throw new Error("ImageGenerationRequest.assetRole must be background");
  if (!["9:16", "16:9", "1:1"].includes(String(request.aspectRatio))) throw new Error("ImageGenerationRequest.aspectRatio is invalid");
  if (!Array.isArray(request.referenceAssetIds) || !request.referenceAssetIds.every((item) => typeof item === "string")) {
    throw new Error("ImageGenerationRequest.referenceAssetIds must be a string array");
  }
  if (!Number.isInteger(request.variants) || Number(request.variants) < 1) {
    throw new Error("ImageGenerationRequest.variants must be a positive integer");
  }
  const targetSize = request.targetSize as Record<string, unknown> | undefined;
  if (!targetSize || !Number.isInteger(targetSize.width) || !Number.isInteger(targetSize.height) || Number(targetSize.width) < 1 || Number(targetSize.height) < 1) {
    throw new Error("ImageGenerationRequest.targetSize must contain positive integer width and height");
  }
}

function buildChildPrompt(request: ImageGenerationRequest, outputDir: string): string {
  return [
    "You are a non-interactive image generation worker for qivance-music.",
    "Use the $imagegen skill and the built-in image_gen tool to generate raster image files.",
    "Do not create SVG, HTML, CSS, canvas, or placeholder files.",
    "Do not modify source code or project metadata.",
    "",
    "Generate background image candidates for this request:",
    JSON.stringify(request, null, 2),
    "",
    `Save exactly ${request.variants} PNG file(s) inside this output directory: ${outputDir}`,
    "If image_gen saves to $CODEX_HOME/generated_images first, copy or move the selected final PNG file(s) into that output directory.",
    "Use stable filenames derived from the request id, for example <requestId>_v1.png.",
    "The images should match the prompt, aspect ratio, and target size as closely as the tool permits.",
    "",
    "Final response requirements:",
    "- Return only JSON matching the provided output schema.",
    "- On success: {\"status\":\"succeeded\",\"candidatePaths\":[\"/absolute/path/to/file.png\"],\"diagnostics\":[]}",
    "- On failure: {\"status\":\"failed\",\"candidatePaths\":[],\"diagnostics\":[\"specific reason\"]}",
  ].join("\n");
}

function childResponseSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["status", "candidatePaths", "diagnostics"],
    properties: {
      status: { enum: ["succeeded", "failed"] },
      candidatePaths: {
        type: "array",
        items: { type: "string" },
      },
      diagnostics: {
        type: "array",
        items: { type: "string" },
      },
    },
  };
}

function parseChildResponse(raw: string): ChildImageGenResponse {
  const parsed = parseJsonObject(raw);
  if (!parsed || typeof parsed !== "object") throw new Error("codex exec image_gen smoke final response must be an object");
  const response = parsed as Record<string, unknown>;
  const status = response.status;
  if (status !== "succeeded" && status !== "failed") throw new Error("codex exec image_gen smoke final response status is invalid");
  if (!Array.isArray(response.candidatePaths) || !response.candidatePaths.every((item) => typeof item === "string")) {
    throw new Error("codex exec image_gen smoke final response candidatePaths must be a string array");
  }
  if (!Array.isArray(response.diagnostics) || !response.diagnostics.every((item) => typeof item === "string")) {
    throw new Error("codex exec image_gen smoke final response diagnostics must be a string array");
  }
  return {
    status,
    candidatePaths: response.candidatePaths,
    diagnostics: response.diagnostics,
  };
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced?.[1]) return JSON.parse(fenced[1].trim());
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("response did not contain JSON");
  }
}

async function resolveCandidatePath(candidatePath: string, outputDir: string): Promise<string> {
  const absolutePath = path.isAbsolute(candidatePath) ? candidatePath : path.resolve(outputDir, candidatePath);
  const [realOutputDir, realCandidatePath] = await Promise.all([
    realpath(outputDir),
    realpath(absolutePath),
  ]);
  if (!isInsideDirectory(realCandidatePath, realOutputDir)) {
    throw new Error(`codex exec image_gen smoke candidate is outside outputDir: ${candidatePath}`);
  }
  if (path.extname(realCandidatePath).toLowerCase() !== ".png") {
    throw new Error(`codex exec image_gen smoke candidate must be a PNG file: ${candidatePath}`);
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
    throw new Error(`codex exec image_gen smoke candidate is not a readable PNG: ${filePath}`);
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

async function runCodexExec(input: {
  command: string;
  args: string[];
  stdin: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });
    child.stdin.end(input.stdin);
  });
}

function trimForError(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 600 ? `${trimmed.slice(0, 600)}...` : trimmed;
}
