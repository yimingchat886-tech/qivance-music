import { createReadStream } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSmallProjectPaths } from "./lib/project-core/paths.ts";
import { formatStartupMessage } from "./lib/server-urls.ts";
import { runHtmlVideoWorkflow } from "./lib/video-html/html-video-workflow.ts";
import { loadHtmlVideoPreviewModel, resolvePreviewFramePath } from "./lib/video-html/preview-model.ts";

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
    sendHtml(response, renderProjectsPage(await listSmallProjectIds()));
    return;
  }

  const runMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/video-html\/run$/);
  if (request.method === "POST" && runMatch) {
    const smallProjectId = decodeURIComponent(runMatch[1]);
    const result = await runHtmlVideoWorkflow(smallProjectId, { storageRoot });
    sendJson(response, {
      smallProjectId: result.smallProjectId,
      preview: result.preview,
      renderManifest: result.renderManifest,
    });
    return;
  }

  const previewMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/video-html\/preview$/);
  if (request.method === "GET" && previewMatch) {
    const smallProjectId = decodeURIComponent(previewMatch[1]);
    sendJson(response, await loadHtmlVideoPreviewModel(resolveSmallProjectPaths(storageRoot, smallProjectId)));
    return;
  }

  const frameMatch = url.pathname.match(/^\/preview\/([^/]+)\/frames\/([^/]+)$/);
  if (request.method === "GET" && frameMatch) {
    const smallProjectId = decodeURIComponent(frameMatch[1]);
    const filename = decodeURIComponent(frameMatch[2]);
    await sendFrame(response, resolveSmallProjectPaths(storageRoot, smallProjectId), filename);
    return;
  }

  const downloadMatch = url.pathname.match(/^\/projects\/([^/]+)\/download$/);
  if (request.method === "GET" && downloadMatch) {
    const smallProjectId = decodeURIComponent(downloadMatch[1]);
    const relativePath = url.searchParams.get("path") ?? "";
    await sendDownload(response, resolveSmallProjectPaths(storageRoot, smallProjectId).projectRoot, relativePath);
    return;
  }

  response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
  response.end(renderNotFound());
}

async function listSmallProjectIds(): Promise<string[]> {
  try {
    const entries = await readdir(storageRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => /^[a-zA-Z0-9_-]+$/.test(name))
      .sort();
  } catch {
    return [];
  }
}

async function sendFrame(response: ServerResponse, paths: ReturnType<typeof resolveSmallProjectPaths>, filename: string): Promise<void> {
  let framePath: string;
  try {
    framePath = resolvePreviewFramePath(paths, filename);
  } catch {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Invalid preview frame filename.");
    return;
  }
  await sendFile(response, framePath, "text/html; charset=utf-8");
}

async function sendDownload(response: ServerResponse, projectPath: string, relativePath: string): Promise<void> {
  if (!relativePath || relativePath.includes("..") || path.isAbsolute(relativePath)) {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Invalid download path.");
    return;
  }
  const resolvedProjectPath = path.resolve(projectPath);
  const absolutePath = path.resolve(resolvedProjectPath, relativePath);
  if (absolutePath !== resolvedProjectPath && !absolutePath.startsWith(resolvedProjectPath + path.sep)) {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Invalid download path.");
    return;
  }
  await sendFile(response, absolutePath, contentType(relativePath));
}

async function sendFile(response: ServerResponse, absolutePath: string, type: string): Promise<void> {
  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("File not found.");
      return;
    }
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("File not found.");
    return;
  }
  response.writeHead(200, { "content-type": type });
  createReadStream(absolutePath).pipe(response);
}

function renderProjectsPage(projectIds: string[]): string {
  const rows = projectIds.length === 0
    ? "<li>No html-video projects yet.</li>"
    : projectIds.map((id) => `<li><code>${escapeHtml(id)}</code> <a href="/api/projects/${encodeURIComponent(id)}/video-html/preview">preview json</a></li>`).join("");
  return layout("Qivance html-video", `<h1>Qivance html-video</h1><ul>${rows}</ul>`);
}

function renderNotFound(): string {
  return layout("Not found", "<h1>Not found</h1>");
}

function layout(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;margin:40px;line-height:1.5}code{background:#f3f4f6;padding:2px 4px}</style></head><body>${body}</body></html>`;
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(303, { location });
  response.end();
}

function contentType(relativePath: string): string {
  if (relativePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (relativePath.endsWith(".mp4")) return "video/mp4";
  if (relativePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (relativePath.endsWith(".wav")) return "audio/wav";
  return "application/octet-stream";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
