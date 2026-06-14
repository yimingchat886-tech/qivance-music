import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(rootDir, "src", "server.ts");

const args = new Set(process.argv.slice(2));
if (!args.has("--primary")) {
  console.error("usage: scripts/e2e-product-v3.ts --primary [--project-id <id>] [--storage-root <path>]");
  process.exit(2);
}

const storageRoot = path.resolve(argValue("--storage-root") ?? "projects");
const projectId = argValue("--project-id") ?? `v3_product_primary_9x16_${stamp()}`;
const projectRoot = path.join(storageRoot, projectId);
const fixtureRoot = path.join(rootDir, "fixtures", "media-e2e-v2", "portrait-9x16");
const existingCandidatePath = path.join(rootDir, "projects", "media_e2e_v2_portrait_9x16", "assets", "generated-backgrounds", "img_req_scene_001_bg_v1.png");
const apiTimeoutMs = 12 * 60 * 1000;

await preparePrimaryProject();
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
    body: { approved_by: "e2e-product-v3", source: "script" },
  });
  const scheduleResponse = await api(baseUrl, `/api/projects/${projectId}/images/schedule/recommend`, {
    method: "POST",
    body: { primary_ratio: "9:16" },
  });
  const schedule = scheduleResponse.image_generation_schedule.data;
  const primaryItem = schedule.items.find((item: any) => item.scene_id === "scene_001_hook") ?? schedule.items[0];
  if (!primaryItem) throw new Error("schedule recommendation returned no image items");
  schedule.status = "confirmed";
  schedule.items = schedule.items.map((item: any) => item.image_id === primaryItem.image_id
    ? { ...item, status: "prompt_confirmed", skip: false, requires_prompt: true, requires_generation: false }
    : { ...item, status: "skipped", skip: true, requires_prompt: false, requires_generation: false });
  await api(baseUrl, `/api/projects/${projectId}/images/schedule`, {
    method: "POST",
    body: { schedule },
  });
  const promptGroupResponse = await api(baseUrl, `/api/projects/${projectId}/images/prompt-group`, {
    method: "POST",
    body: {
      style_id: "high_contrast_cyber_classroom",
      scene_prompts: {
        [primaryItem.image_id]: "Rapper teacher in a cyber classroom with abstract knowledge graph light, no text",
      },
      confirm: true,
      created_by: "e2e-product-v3",
    },
  });
  await writeImageGenerationResult(primaryItem, promptGroupResponse.image_prompt_group.data);
  const candidateId = `${primaryItem.image_id}_v1`;
  await api(baseUrl, `/api/projects/${projectId}/images/${candidateId}/lock`, {
    method: "POST",
    body: { reason: "production-allowed existing candidate evidence", decided_by: "e2e-product-v3" },
  });
  const agentRunResponse = await api(baseUrl, `/api/projects/${projectId}/html-video/run-agent`, {
    method: "POST",
    body: {},
  });
  await api(baseUrl, `/api/projects/${projectId}/html-video/preview`);
  const revisionResponse = await api(baseUrl, `/api/projects/${projectId}/html-video/revise`, {
    method: "POST",
    body: {
      scope: { type: "scene", scene_id: primaryItem.scene_id },
      request: "Make the opening feel more like a rap classroom while preserving the locked background asset.",
      created_by: "e2e-product-v3",
    },
  });
  const renderResponse = await api(baseUrl, `/api/projects/${projectId}/export/render`, {
    method: "POST",
    body: {},
  });
  const result = {
    status: "passed",
    project_id: projectId,
    project_root: projectRoot,
    agent_run: agentRunResponse.agent_run.path,
    revision_agent_run: revisionResponse.agent_run.path,
    render_manifest: renderResponse.render_manifest.path,
    final_mp4: renderResponse.final_mp4.path,
  };
  await writeJson(path.join(projectRoot, "exports", "e2e_product_v3_result.json"), result);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await stopServer(server);
}

async function preparePrimaryProject(): Promise<void> {
  await assertFile(existingCandidatePath);
  await mkdir(projectRoot, { recursive: true });
  await mkdir(path.join(projectRoot, "audio", "master"), { recursive: true });
  await mkdir(path.join(projectRoot, "timing"), { recursive: true });
  await mkdir(path.join(projectRoot, "data", "storyboard"), { recursive: true });
  await copyFile(path.join(fixtureRoot, "active_music_take.mp3"), path.join(projectRoot, "active_music_take.mp3"));
  await copyFile(path.join(fixtureRoot, "active_music_take.mp3"), path.join(projectRoot, "audio", "master", "active_music_take.mp3"));
  await copyFile(path.join(fixtureRoot, "lyrics.md"), path.join(projectRoot, "lyrics.md"));
  await copyFile(path.join(fixtureRoot, "lyrics.md"), path.join(projectRoot, "timing", "lyrics.md"));
  await copyFile(path.join(fixtureRoot, "audio_analysis", "beat_grid.json"), path.join(projectRoot, "timing", "beat_grid.json"));
  await copyFile(path.join(fixtureRoot, "audio_analysis", "onset_events.json"), path.join(projectRoot, "timing", "onset_events.json"));
  await copyFile(path.join(fixtureRoot, "audio_analysis", "energy_curve.json"), path.join(projectRoot, "timing", "energy_curve.json"));
  await copyFile(path.join(fixtureRoot, "lyric_word_timing.json"), path.join(projectRoot, "timing", "lyric_word_timing.json"));
  const fixturePlan = await readJson<any>(path.join(fixtureRoot, "animation_plan.json"));
  fixturePlan.small_project_id = projectId;
  await writeJson(path.join(projectRoot, "animation_plan.json"), fixturePlan);
  const imagePlan = await readJson<any>(path.join(fixtureRoot, "image_generation_plan.json"));
  imagePlan.small_project_id = projectId;
  await writeJson(path.join(projectRoot, "image_generation_plan.json"), imagePlan);
  const sectionMap = {
    schema_version: 1,
    duration_sec: fixturePlan.duration_sec,
    sections: fixturePlan.scenes.map((scene: any) => ({
      section_id: scene.section_ids?.[0] ?? scene.scene_id,
      scene_id: scene.scene_id,
      start_sec: scene.start_sec,
      end_sec: scene.end_sec,
      duration_sec: scene.end_sec - scene.start_sec,
    })),
  };
  await writeJson(path.join(projectRoot, "timing", "section_map.json"), sectionMap);
  await writeJson(path.join(projectRoot, "data", "storyboard", "section_map.json"), sectionMap);
}

async function writeImageGenerationResult(primaryItem: any, promptGroup: any): Promise<void> {
  const outputDir = path.join(projectRoot, "assets", "images", "generated");
  await mkdir(outputDir, { recursive: true });
  const candidatePath = path.join(outputDir, `${primaryItem.image_id}_v1.png`);
  await copyFile(existingCandidatePath, candidatePath);
  const prompt = promptGroup.items.find((item: any) => item.image_id === primaryItem.image_id)?.final_prompt;
  if (!prompt) throw new Error(`missing confirmed prompt for ${primaryItem.image_id}`);
  const relativeCandidatePath = normalizePath(path.relative(projectRoot, candidatePath));
  const result = [{
    requestId: primaryItem.image_id,
    adapterId: "codex_image_gen",
    status: "succeeded",
    candidates: [{
      candidateId: `${primaryItem.image_id}_v1`,
      path: relativeCandidatePath,
      sha256: await sha256File(candidatePath),
      width: primaryItem.target_size.width,
      height: primaryItem.target_size.height,
      provenance: {
        adapter: "existing_v2_fixture_candidate",
        source_path: normalizePath(path.relative(rootDir, existingCandidatePath)),
      },
    }],
  }];
  await writeJson(path.join(projectRoot, "data", "storyboard", "image_generation_results.json"), result);
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

async function assertFile(filePath: string): Promise<void> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error(`required file is not a file: ${filePath}`);
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function stamp(): string {
  return new Date().toISOString().replaceAll(/[^0-9]+/g, "").slice(0, 14);
}

function normalizePath(value: string): string {
  return value.replaceAll(path.sep, "/");
}
