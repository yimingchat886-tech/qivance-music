import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { confirmImagePromptGroup, createImagePromptGroup } from "../src/lib/image-generation/image-prompt-group.ts";
import { recommendImageGenerationSchedule, type ImageGenerationSchedule } from "../src/lib/image-generation/image-schedule.ts";
import type { ImageGenerationResult } from "../src/lib/image-generation/types.ts";

const serverPath = fileURLToPath(new URL("../src/server.ts", import.meta.url));

test("V3 project APIs list, inspect, report status, and approve animation plans", async () => {
  const tempRoot = await mkdtemp(path.join("/tmp", "qivance-workbench-api-"));
  const storageRoot = path.join(tempRoot, "projects");
  const smallProjectId = "api_project_001";
  const projectRoot = path.join(storageRoot, smallProjectId);
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "active_music_take.mp3"), "audio", "utf8");
  await writeFile(path.join(projectRoot, "lyrics.md"), "lyrics", "utf8");
  await writeJson(path.join(projectRoot, "image_generation_plan.json"), { schema_version: 1 });
  await mkdir(path.join(projectRoot, "data", "storyboard"), { recursive: true });
  await writeJson(path.join(projectRoot, "data", "storyboard", "section_map.json"), {
    schema_version: 1,
    duration_sec: 8,
    sections: [
      { section_id: "sec_001", scene_id: "scene_001_hook", start_sec: 0, end_sec: 8 },
    ],
  });
  const animationPlan = {
    schema_version: 1,
    small_project_id: smallProjectId,
    aspectRatio: "9:16",
  };
  await writeJson(path.join(projectRoot, "animation_plan.json"), animationPlan);
  const originalAnimationPlan = await readFile(path.join(projectRoot, "animation_plan.json"), "utf8");

  const port = await getFreePort();
  const server = spawn(process.execPath, ["--experimental-strip-types", serverPath], {
    cwd: tempRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      QIVANCE_PROJECTS_ROOT: "projects",
    },
  });

  try {
    await waitForServer(server, port);
    const baseUrl = `http://127.0.0.1:${port}`;

    const projectsResponse = await fetch(`${baseUrl}/api/projects`);
    assert.equal(projectsResponse.status, 200);
    const projects = await projectsResponse.json();
    assert.deepEqual(projects.projects.map((project: any) => project.small_project_id), [smallProjectId]);
    assert.equal(projects.projects[0].project_root, `projects/${smallProjectId}`);
    assert.equal(projects.projects[0].mode, "image_music_mode");

    const detailResponse = await fetch(`${baseUrl}/api/projects/${smallProjectId}`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    assert.equal(detail.project.small_project_id, smallProjectId);
    assert.equal(detail.status.inputs.animation_plan.approved, false);

    const statusResponse = await fetch(`${baseUrl}/api/projects/${smallProjectId}/status`);
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.ok(status.blocking_reasons.some((reason: any) => reason.code === "animation_plan_unapproved"));

    const invalidJsonResponse = await fetch(`${baseUrl}/api/projects/${smallProjectId}/animation-plan/approve`, {
      method: "POST",
      body: "{invalid",
    });
    assert.equal(invalidJsonResponse.status, 400);
    assert.equal((await invalidJsonResponse.json()).error.code, "invalid_json");

    const approvalResponse = await fetch(`${baseUrl}/api/projects/${smallProjectId}/animation-plan/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved_by: "api-test" }),
    });
    assert.equal(approvalResponse.status, 200);
    const approval = await approvalResponse.json();
    assert.equal(approval.approved, true);
    assert.equal(approval.approved_by, "api-test");
    assert.equal(approval.source, "workbench");

    assert.equal(await readFile(path.join(projectRoot, "animation_plan.json"), "utf8"), originalAnimationPlan);
    const checkpoints = JSON.parse(await readFile(path.join(projectRoot, "workflow_checkpoints.json"), "utf8"));
    assert.equal(checkpoints.animation_plan.approved, true);
    assert.equal(checkpoints.animation_plan.approved_by, "api-test");

    const approvedStatusResponse = await fetch(`${baseUrl}/api/projects/${smallProjectId}/status`);
    assert.equal(approvedStatusResponse.status, 200);
    const approvedStatus = await approvedStatusResponse.json();
    assert.equal(approvedStatus.inputs.animation_plan.approved, true);
    assert.equal(approvedStatus.blocking_reasons.some((reason: any) => reason.code === "animation_plan_unapproved"), false);

    const missingProjectResponse = await fetch(`${baseUrl}/api/projects/missing_project/status`);
    assert.equal(missingProjectResponse.status, 404);
    assert.equal((await missingProjectResponse.json()).error.code, "project_not_found");

    const invalidProjectResponse = await fetch(`${baseUrl}/api/projects/..%2Fsecret/animation-plan/approve`, {
      method: "POST",
      body: "{}",
    });
    assert.equal(invalidProjectResponse.status, 400);
    assert.equal((await invalidProjectResponse.json()).error.code, "invalid_project_id");

    const remoteSourceVideoResponse = await fetch(`${baseUrl}/api/projects/${smallProjectId}/source-video/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_path: "https://example.com/video.mp4" }),
    });
    assert.equal(remoteSourceVideoResponse.status, 400);
    assert.equal((await remoteSourceVideoResponse.json()).error.code, "source_video_import_failed");

    const emptyRevisionResponse = await fetch(`${baseUrl}/api/projects/${smallProjectId}/html-video/revise`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(emptyRevisionResponse.status, 400);
    assert.equal((await emptyRevisionResponse.json()).error.code, "invalid_revision_request");

    const multiRevisionResponse = await fetch(`${baseUrl}/api/projects/${smallProjectId}/html-video/revise`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requests: ["first", "second"] }),
    });
    assert.equal(multiRevisionResponse.status, 400);
    assert.equal((await multiRevisionResponse.json()).error.code, "invalid_revision_request");

    const scheduleResponse = await fetch(`${baseUrl}/api/projects/${smallProjectId}/images/schedule`);
    assert.equal(scheduleResponse.status, 200);
    const schedule = await scheduleResponse.json();
    assert.equal(schedule.artifact.exists, false);
    assert.equal(schedule.artifact.path, "data/storyboard/image_generation_schedule.json");

    const recommendedScheduleResponse = await fetch(`${baseUrl}/api/projects/${smallProjectId}/images/schedule/recommend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ primary_ratio: "9:16" }),
    });
    assert.equal(recommendedScheduleResponse.status, 200);
    const recommendedSchedule = await recommendedScheduleResponse.json();
    assert.equal(recommendedSchedule.image_generation_schedule.data.items[0].scene_id, "scene_001_hook");

    const confirmedSchedule = {
      ...recommendedSchedule.image_generation_schedule.data,
      status: "confirmed",
      items: recommendedSchedule.image_generation_schedule.data.items.map((item: any) => ({ ...item, status: "prompt_confirmed" })),
    };
    const scheduleUpdateResponse = await fetch(`${baseUrl}/api/projects/${smallProjectId}/images/schedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schedule: confirmedSchedule }),
    });
    assert.equal(scheduleUpdateResponse.status, 200);

    const promptGroupResponse = await fetch(`${baseUrl}/api/projects/${smallProjectId}/images/prompt-group`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        style_id: "high_contrast_cyber_classroom",
        scene_prompts: { scene_001_hook: "Cyber classroom rap teacher, no text" },
        confirm: true,
      }),
    });
    assert.equal(promptGroupResponse.status, 200);
    const promptGroup = await promptGroupResponse.json();
    assert.equal(promptGroup.image_prompt_group.data.status, "confirmed");
    assert.equal(promptGroup.image_prompt_group.data.provenance.llm_assisted, false);

    const pendingMutationResponse = await fetch(`${baseUrl}/api/projects/${smallProjectId}/images/run-generation`, {
      method: "POST",
      body: "{}",
    });
    assert.equal(pendingMutationResponse.status, 400);
    assert.equal((await pendingMutationResponse.json()).error.code, "invalid_image_id");
  } finally {
    await stopServer(server);
  }
});

test("V3 image review APIs persist decisions and expose them through image artifacts", async () => {
  const tempRoot = await mkdtemp(path.join("/tmp", "qivance-workbench-review-api-"));
  const storageRoot = path.join(tempRoot, "projects");
  const smallProjectId = "api_review_001";
  const projectRoot = path.join(storageRoot, smallProjectId);
  await mkdir(path.join(projectRoot, "data", "storyboard"), { recursive: true });
  await writeFile(path.join(projectRoot, "active_music_take.mp3"), "audio", "utf8");
  await writeFile(path.join(projectRoot, "lyrics.md"), "lyrics", "utf8");
  await writeJson(path.join(projectRoot, "image_generation_plan.json"), { schema_version: 1 });
  await writeJson(path.join(projectRoot, "animation_plan.json"), { schema_version: 1, small_project_id: smallProjectId, aspectRatio: "9:16" });
  await writeJson(path.join(projectRoot, "workflow_checkpoints.json"), { schema_version: 1, animation_plan: { approved: true } });
  const { schedule, imageResults } = await writeReviewApiFixture(projectRoot, smallProjectId);
  const firstImageId = schedule.items[0]!.image_id;
  const secondImageId = schedule.items[1]!.image_id;
  const firstCandidateId = imageResults[0]!.candidates[0]!.candidateId;

  const port = await getFreePort();
  const server = spawn(process.execPath, ["--experimental-strip-types", serverPath], {
    cwd: tempRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      QIVANCE_PROJECTS_ROOT: "projects",
    },
  });

  try {
    await waitForServer(server, port);
    const baseUrl = `http://127.0.0.1:${port}`;

    const lockResponse = await fetch(`${baseUrl}/api/projects/${smallProjectId}/images/${firstCandidateId}/lock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "best fit", decided_by: "api-test" }),
    });
    assert.equal(lockResponse.status, 200);
    const lock = await lockResponse.json();
    assert.equal(lock.image_assets.data.assets.length, 1);
    assert.equal(lock.image_review_decisions.data.decisions[0].action, "lock");

    const rejectResponse = await fetch(`${baseUrl}/api/projects/${smallProjectId}/images/${firstCandidateId}/reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "replace it" }),
    });
    assert.equal(rejectResponse.status, 200);
    const reject = await rejectResponse.json();
    assert.equal(reject.image_assets.data.assets.length, 0);
    assert.equal(reject.image_review_decisions.data.decisions[0].action, "reject");

    const skipResponse = await fetch(`${baseUrl}/api/projects/${smallProjectId}/images/skip`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image_id: secondImageId, reason: "covered by animation" }),
    });
    assert.equal(skipResponse.status, 200);
    const skip = await skipResponse.json();
    assert.equal(skip.image_generation_schedule.data.items[1].status, "skipped");
    assert.equal(skip.image_review_decisions.data.decisions.find((decision: { image_id: string }) => decision.image_id === secondImageId).action, "skip");

    const regenerateResponse = await fetch(`${baseUrl}/api/projects/${smallProjectId}/images/run-generation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image_id: firstImageId, prompt_override: "alternate cyber classroom camera angle" }),
    });
    assert.equal(regenerateResponse.status, 200);
    const regenerate = await regenerateResponse.json();
    assert.equal(regenerate.action, "regenerate");
    assert.match(regenerate.image_generation_request.prompt, /high contrast cyber classroom/);
    assert.match(regenerate.image_generation_request.prompt, /alternate cyber classroom camera angle/);

    const imagesResponse = await fetch(`${baseUrl}/api/projects/${smallProjectId}/images`);
    assert.equal(imagesResponse.status, 200);
    const images = await imagesResponse.json();
    assert.equal(images.image_review_decisions.exists, true);
    assert.deepEqual(images.image_review_decisions.data.decisions.map((decision: { action: string }) => decision.action), ["skip", "regenerate"]);
  } finally {
    await stopServer(server);
  }
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeReviewApiFixture(
  projectRoot: string,
  smallProjectId: string,
): Promise<{ schedule: ImageGenerationSchedule; imageResults: ImageGenerationResult[] }> {
  const schedule = recommendImageGenerationSchedule({
    smallProjectId,
    sectionMap: {
      schema_version: 1,
      duration_sec: 8,
      sections: [
        { section_id: "sec_001", scene_id: "scene_001_hook", start_sec: 0, end_sec: 4 },
        { section_id: "sec_002", scene_id: "scene_002_build", start_sec: 4, end_sec: 8 },
      ],
    },
    sourceSectionMapSha256: "section-map-hash",
    generatedAt: "2026-06-12T00:00:00.000Z",
  });
  schedule.status = "confirmed";
  schedule.items = schedule.items.map((item) => ({ ...item, status: "prompt_confirmed" }));
  const promptGroup = confirmImagePromptGroup(createImagePromptGroup({
    smallProjectId,
    schedule,
    styleId: "high_contrast_cyber_classroom",
  }));
  const imageResults: ImageGenerationResult[] = [];
  await mkdir(path.join(projectRoot, "assets", "images", "generated"), { recursive: true });
  for (const item of schedule.items) {
    const candidatePath = path.join(projectRoot, "assets", "images", "generated", `${item.image_id}_v1.png`);
    const contents = Buffer.from(`candidate:${item.image_id}`);
    await writeFile(candidatePath, contents);
    imageResults.push({
      requestId: item.image_id,
      adapterId: "codex_image_gen",
      status: "succeeded",
      candidates: [
        {
          candidateId: `${item.image_id}_v1`,
          path: candidatePath,
          sha256: sha256(contents),
          width: item.target_size.width,
          height: item.target_size.height,
          provenance: { adapter: "test" },
        },
      ],
    });
  }
  await writeJson(path.join(projectRoot, "data", "storyboard", "image_generation_schedule.json"), schedule);
  await writeJson(path.join(projectRoot, "data", "storyboard", "image_prompt_group.json"), promptGroup);
  await writeJson(path.join(projectRoot, "data", "storyboard", "image_generation_results.json"), imageResults);
  return { schedule, imageResults };
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function getFreePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address) {
          resolve(address.port);
        } else {
          reject(new Error("Failed to allocate a test port."));
        }
      });
    });
  });
}

async function waitForServer(server: ChildProcessWithoutNullStreams, port: number): Promise<void> {
  let stderr = "";
  server.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Server exited before startup. stderr: ${stderr}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/projects`);
      await response.arrayBuffer();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Timed out waiting for server startup. stderr: ${stderr}`);
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
