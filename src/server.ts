import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { saveAudioAsset } from "./lib/audio-db.ts";
import { importAcceptedMusicProject } from "./lib/import-project.ts";
import { parseMultipartForm, type MultipartForm } from "./lib/multipart-form.ts";
import {
  approvePreview,
  approveScenePlan,
  generateBeatLock,
  generateHypeframesProject,
  generateScenePlans,
  generateSectionMap,
  lockAcceptedMusic,
  renderPreview,
} from "./lib/post-minimax-workflow.ts";
import { formatStartupMessage } from "./lib/server-urls.ts";
import {
  listProjectSummaries,
  loadProjectSummary,
  renderImportPage,
  renderNotFound,
  renderProjectWorkspace,
  renderProjectsPage,
} from "./lib/web-ui.ts";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storageRoot = process.env.QIVANCE_PROJECTS_ROOT ?? path.join(rootDir, "projects");
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST?.trim() || "0.0.0.0";

await mkdir(storageRoot, { recursive: true });

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.stack : String(error));
  }
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  console.log(formatStartupMessage({ host, port: actualPort, interfaces: networkInterfaces() }));
});

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  if (request.method === "GET" && url.pathname === "/") {
    redirect(response, "/projects");
    return;
  }
  if (request.method === "GET" && url.pathname === "/projects") {
    sendHtml(response, renderProjectsPage(await listProjectSummaries(storageRoot)));
    return;
  }
  if (request.method === "GET" && url.pathname === "/projects/new") {
    sendHtml(response, renderImportPage());
    return;
  }
  if (request.method === "POST" && url.pathname === "/projects/import") {
    const form = parseMultipartForm(String(request.headers["content-type"] ?? ""), await readBody(request));
    const audioFile = requiredFile(form, "rawAudioFile");
    const audioAsset = await saveAudioAsset(storageRoot, {
      filename: audioFile.filename,
      mimeType: audioFile.mimeType,
      data: audioFile.data,
    });
    const imported = await importAcceptedMusicProject({
      storageRoot,
      topic: requiredField(form, "topic"),
      targetDuration: requiredPositiveNumber(form, "targetDuration"),
      lyricsMarkdown: requiredField(form, "lyricsMarkdown"),
      audioAssetId: audioAsset.id,
      mainComposition: requiredField(form, "mainComposition"),
      videoSize: requiredField(form, "videoSize"),
    });
    redirect(response, `/projects/${encodeURIComponent(imported.projectId)}`);
    return;
  }

  const runMatch = url.pathname.match(/^\/projects\/([^/]+)\/run-preview$/);
  if (request.method === "POST" && runMatch) {
    const projectId = decodeURIComponent(runMatch[1]);
    await runPostMinimaxToSceneApproval(path.join(storageRoot, projectId));
    redirect(response, `/projects/${encodeURIComponent(projectId)}`);
    return;
  }

  const approveSceneMatch = url.pathname.match(/^\/projects\/([^/]+)\/approve-scene$/);
  if (request.method === "POST" && approveSceneMatch) {
    const projectId = decodeURIComponent(approveSceneMatch[1]);
    const projectPath = path.join(storageRoot, projectId);
    await approveScenePlan(projectPath);
    await generateHypeframesProject(projectPath);
    await renderPreview(projectPath);
    redirect(response, `/projects/${encodeURIComponent(projectId)}`);
    return;
  }

  const approvePreviewMatch = url.pathname.match(/^\/projects\/([^/]+)\/approve-preview$/);
  if (request.method === "POST" && approvePreviewMatch) {
    const projectId = decodeURIComponent(approvePreviewMatch[1]);
    await approvePreview(path.join(storageRoot, projectId));
    redirect(response, `/projects/${encodeURIComponent(projectId)}`);
    return;
  }

  const downloadMatch = url.pathname.match(/^\/projects\/([^/]+)\/download$/);
  if (request.method === "GET" && downloadMatch) {
    const projectId = decodeURIComponent(downloadMatch[1]);
    const relativePath = url.searchParams.get("path") ?? "";
    await sendDownload(response, path.join(storageRoot, projectId), relativePath);
    return;
  }

  const projectMatch = url.pathname.match(/^\/projects\/([^/]+)$/);
  if (request.method === "GET" && projectMatch) {
    const projectId = decodeURIComponent(projectMatch[1]);
    sendHtml(response, renderProjectWorkspace(await loadProjectSummary(path.join(storageRoot, projectId))));
    return;
  }

  response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
  response.end(renderNotFound());
}

async function runPostMinimaxToSceneApproval(projectPath: string): Promise<void> {
  await lockAcceptedMusic(projectPath);
  await generateBeatLock(projectPath);
  await generateSectionMap(projectPath);
  await generateScenePlans(projectPath);
}

async function sendDownload(response: ServerResponse, projectPath: string, relativePath: string): Promise<void> {
  if (!relativePath || relativePath.includes("..") || path.isAbsolute(relativePath)) {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Invalid download path.");
    return;
  }
  const absolutePath = path.join(projectPath, relativePath);
  response.writeHead(200, {
    "content-type": contentType(relativePath),
    "content-disposition": `attachment; filename="${path.basename(relativePath)}"`,
  });
  createReadStream(absolutePath).pipe(response);
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(303, { location });
  response.end();
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function requiredField(form: MultipartForm, name: string): string {
  const value = form.fields.get(name)?.trim();
  if (!value) {
    throw new Error(`Missing form field ${name}`);
  }
  return value;
}

function requiredPositiveNumber(form: MultipartForm, name: string): number {
  const value = Number(requiredField(form, name));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid numeric form field ${name}`);
  }
  return value;
}

function requiredFile(form: MultipartForm, name: string): { filename: string; mimeType: string; data: Buffer } {
  const value = form.files.get(name);
  if (!value || value.data.byteLength === 0) {
    throw new Error(`Missing form file ${name}`);
  }
  return value;
}

function contentType(relativePath: string): string {
  if (relativePath.endsWith(".mp4")) return "video/mp4";
  if (relativePath.endsWith(".wav")) return "audio/wav";
  if (relativePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (relativePath.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (relativePath.endsWith(".jpg") || relativePath.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}
