import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(rootDir, "src", "server.ts");
const args = new Set(process.argv.slice(2));

if (!args.has("--source-video")) {
  console.error("usage: scripts/e2e-source-video-v3.ts --source-video [--project-id <id>] [--storage-root <path>]");
  process.exit(2);
}

const storageRoot = path.resolve(argValue("--storage-root") ?? "projects");
const projectId = argValue("--project-id") ?? `v3_source_video_9x16_${stamp()}`;
const projectRoot = path.join(storageRoot, projectId);
const apiTimeoutMs = 12 * 60 * 1000;

await prepareSourceVideoProject();
const port = await getFreePort();
const server = spawn(process.execPath, ["--experimental-strip-types", serverPath], {
  cwd: rootDir,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    QIVANCE_PROJECTS_ROOT: storageRoot,
  },
});

try {
  await waitForServer(server, port);
  const baseUrl = `http://127.0.0.1:${port}`;
  await api(baseUrl, `/api/projects/${projectId}/animation-plan/approve`, {
    method: "POST",
    body: { approved_by: "e2e-source-video-v3", source: "script" },
  });
  const importResponse = await api(baseUrl, `/api/projects/${projectId}/source-video/import`, {
    method: "POST",
    body: { source_path: "source_video.mp4" },
  });
  const agentRunResponse = await api(baseUrl, `/api/projects/${projectId}/html-video/run-agent`, {
    method: "POST",
    body: {},
  });
  await assertFrameReferencesSourceVideo();
  await api(baseUrl, `/api/projects/${projectId}/html-video/preview`);
  const revisionResponse = await api(baseUrl, `/api/projects/${projectId}/html-video/revise`, {
    method: "POST",
    body: {
      scope: { type: "scene", scene_id: "scene_001_source_video" },
      request: "Keep the source video visible and add a subtle classroom overlay.",
      created_by: "e2e-source-video-v3",
    },
  });
  await assertFrameReferencesSourceVideo();
  const renderResponse = await api(baseUrl, `/api/projects/${projectId}/export/render`, {
    method: "POST",
    body: {},
  });
  const result = {
    status: "passed",
    project_id: projectId,
    project_root: projectRoot,
    source_video_import: importResponse.source_video_import.path,
    agent_run: agentRunResponse.agent_run.path,
    revision_agent_run: revisionResponse.agent_run.path,
    render_manifest: renderResponse.render_manifest.path,
    final_mp4: renderResponse.final_mp4.path,
  };
  await writeJson(path.join(projectRoot, "exports", "e2e_source_video_v3_result.json"), result);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await stopServer(server);
}

async function prepareSourceVideoProject(): Promise<void> {
  await mkdir(projectRoot, { recursive: true });
  await createSourceMp4(path.join(projectRoot, "source_video.mp4"));
  await writeJson(path.join(projectRoot, "animation_plan.json"), {
    schema_version: 1,
    small_project_id: projectId,
    title: "V3 source video E2E",
    duration_sec: 3,
    fps: 30,
    resolution: { width: 540, height: 960 },
    aspect_ratio: "9:16",
    mood: "focused",
    synopsis: "Source video mode validation",
    scenes: [
      {
        scene_id: "scene_001_source_video",
        section_ids: ["sec_001_source_video"],
        start_sec: 0,
        end_sec: 3,
        headline: "Source Video",
      },
    ],
  });
}

async function createSourceMp4(outputPath: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x111827:s=540x960:r=30:d=3",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=3",
    "-shortest",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

async function assertFrameReferencesSourceVideo(): Promise<void> {
  const framePath = path.join(projectRoot, "video", "html-video", ".html-video", "projects", projectId, "frames", "01-scene_001_source_video.html");
  const html = await readFile(framePath, "utf8");
  if (!/(<video|<source)[^>]+src=["']source_video\.mp4["']/i.test(html)) {
    throw new Error(`source video frame did not reference source_video.mp4: ${framePath}`);
  }
}

async function api(baseUrl: string, route: string, input: { method?: string; body?: unknown } = {}): Promise<any> {
  const method = input.method ?? "GET";
  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  const url = new URL(route, baseUrl);
  const { statusCode, text } = await new Promise<{ statusCode: number; text: string }>((resolve, reject) => {
    const request = httpRequest(url, {
      method,
      headers: body === undefined ? undefined : {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
    }, (response) => {
      response.setEncoding("utf8");
      let text = "";
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.on("end", () => {
        resolve({ statusCode: response.statusCode ?? 0, text });
      });
    });
    request.setTimeout(apiTimeoutMs, () => {
      request.destroy(new Error(`${method} ${route} timed out after ${apiTimeoutMs}ms`));
    });
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
  const parsed = text.length > 0 ? JSON.parse(text) : null;
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`${method} ${route} failed with ${statusCode}: ${text}`);
  }
  return parsed;
}

async function waitForServer(server: ChildProcessWithoutNullStreams, port: number): Promise<void> {
  let stderr = "";
  server.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`server exited before startup: ${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/projects`);
      await response.arrayBuffer();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`timed out waiting for server startup: ${stderr}`);
}

async function stopServer(server: ChildProcessWithoutNullStreams): Promise<void> {
  if (server.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    server.once("exit", () => resolve());
    server.kill();
    setTimeout(() => {
      if (server.exitCode === null) server.kill("SIGKILL");
    }, 1000).unref();
  });
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address) resolve(address.port);
        else reject(new Error("failed to allocate free port"));
      });
    });
  });
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}
