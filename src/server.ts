import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectStore, type Project } from "@html-video/core";
import { muxLockedAudio } from "./lib/export/mux-locked-audio.ts";
import {
  buildRenderManifestV3,
  validateRenderManifestV3,
  type RenderManifestV3AgentRunRef,
  type RenderManifestV3ProjectMode,
} from "./lib/export/render-manifest-v3.ts";
import { sha256File } from "./lib/fs-utils.ts";
import { resolveSmallProjectPaths, type SmallProjectPaths } from "./lib/project-core/paths.ts";
import { formatStartupMessage } from "./lib/server-urls.ts";
import { buildAgentContext } from "./lib/video-contract/agent-context.schema.ts";
import type { AnimationPlan, QivanceAspectRatio } from "./lib/video-contract/animation-plan.schema.ts";
import { animationPlanToContentGraph } from "./lib/video-html/animation-plan-to-content-graph.ts";
import { buildCodexFrameAgentPrompt } from "./lib/video-html/codex-frame-agent-prompt.ts";
import { runHtmlVideoWorkflow } from "./lib/video-html/html-video-workflow.ts";
import { ensureHtmlVideoWorkspace } from "./lib/video-html/html-video-workspace.ts";
import { loadHtmlVideoPreviewModel, resolvePreviewFramePath } from "./lib/video-html/preview-model.ts";
import { importSourceVideoAsset } from "./lib/video-html/source-video-import.ts";
import type { SourceVideoImportFile } from "./lib/video-html/source-video-import.ts";
import { renderHtmlVideoVisual } from "./lib/video-html/render-html-video.ts";
import { runHtmlVideoAgentRuntime } from "./lib/video-html/html-video-agent-runtime.ts";
import { validateFrameOutputs } from "./lib/video-html/frame-output-contract-validator.ts";
import type { QivanceFrameContracts } from "./lib/video-html/qivance-frame-contracts.ts";
import { buildFrameContracts } from "./lib/video-html/qivance-frame-contracts.ts";
import { assertAllowedPathChanges, diffSnapshots, snapshotFiles, CodexForbiddenFileChangeError } from "./lib/video-html/path-gate.ts";
import { buildAgentRunLog, writeAgentRunLog } from "./lib/video-html/agent-run-log.ts";
import { createRevisionRequest, withRevisionStatus, writeRevisionRequest } from "./lib/video-html/revision-request.ts";
import {
  readSectionMapForImageSchedule,
  targetSizeForAspectRatio,
  validateImageGenerationSchedule,
  writeRecommendedImageGenerationSchedule,
  type ImageGenerationSchedule,
  type ImageScheduleAspectRatio,
} from "./lib/image-generation/image-schedule.ts";
import {
  confirmImagePromptGroup,
  createImagePromptGroup,
  validateImagePromptGroup,
  writeImagePromptGroup,
  type ImagePromptGroup,
} from "./lib/image-generation/image-prompt-group.ts";
import {
  applyImageReviewAction,
  buildRegenerationImageRequest,
  readImageReviewDecisionFile,
  validateImageReviewDecisionFile,
  writeImageReviewDecisionFile,
  writeLockedImageAssetsFromReview,
  type ImageReviewAction,
} from "./lib/image-generation/image-review-decisions.ts";
import type { ImageGenerationResult } from "./lib/image-generation/types.ts";
import type {
  AnimationPlanApprovalResponse,
  ImageArtifactsResponse,
  JsonArtifactResponse,
  V3ProjectDetailResponse,
  V3ProjectListItem,
  V3ProjectListResponse,
} from "./lib/workbench/api-types.ts";
import { readWorkbenchProjectStatus, type WorkbenchProjectStatus } from "./lib/workbench/project-status.ts";
import { renderWorkbenchProjectDetailPage, renderWorkbenchProjectsPage } from "./lib/workbench/workbench-html.ts";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storageRoot = process.env.QIVANCE_PROJECTS_ROOT ?? path.join(rootDir, "projects");
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST?.trim() || "0.0.0.0";

await mkdir(storageRoot, { recursive: true });

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    if (response.headersSent) {
      response.end();
      return;
    }
    if (request.url?.startsWith("/api/")) {
      const routeError = toRouteError(error);
      sendApiError(response, routeError.status, routeError.code, routeError.message);
      return;
    }
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
    sendHtml(response, renderWorkbenchProjectsPage({ projects: (await listApiProjects()).projects }));
    return;
  }

  const projectPageMatch = url.pathname.match(/^\/projects\/([^/]+)$/);
  if (request.method === "GET" && projectPageMatch) {
    const paths = await resolveExistingProjectPaths(projectPageMatch[1]);
    const status = await readWorkbenchProjectStatus({ storageRoot, smallProjectId: paths.smallProjectId });
    sendHtml(response, renderWorkbenchProjectDetailPage({ status }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/projects") {
    sendJson(response, await listApiProjects());
    return;
  }

  const projectDetailMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (request.method === "GET" && projectDetailMatch) {
    const paths = await resolveExistingProjectPaths(projectDetailMatch[1]);
    const status = await readWorkbenchProjectStatus({ storageRoot, smallProjectId: paths.smallProjectId });
    sendJson(response, projectDetailResponse(status));
    return;
  }

  const statusMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/status$/);
  if (request.method === "GET" && statusMatch) {
    const paths = await resolveExistingProjectPaths(statusMatch[1]);
    sendJson(response, await readWorkbenchProjectStatus({ storageRoot, smallProjectId: paths.smallProjectId }));
    return;
  }

  const approvalMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/animation-plan\/approve$/);
  if (request.method === "POST" && approvalMatch) {
    const paths = await resolveExistingProjectPaths(approvalMatch[1]);
    const body = await readJsonRequestBody(request);
    sendJson(response, await approveAnimationPlan(paths, body));
    return;
  }

  const imagesMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/images$/);
  if (request.method === "GET" && imagesMatch) {
    const paths = await resolveExistingProjectPaths(imagesMatch[1]);
    sendJson(response, await imageArtifactsResponse(paths));
    return;
  }

  const scheduleMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/images\/schedule$/);
  if (request.method === "GET" && scheduleMatch) {
    const paths = await resolveExistingProjectPaths(scheduleMatch[1]);
    sendJson(response, await jsonArtifactResponse(paths, "image_generation_schedule", "data/storyboard/image_generation_schedule.json"));
    return;
  }

  const promptGroupMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/images\/prompt-group$/);
  if (request.method === "GET" && promptGroupMatch) {
    const paths = await resolveExistingProjectPaths(promptGroupMatch[1]);
    sendJson(response, await jsonArtifactResponse(paths, "image_prompt_group", "data/storyboard/image_prompt_group.json"));
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

  const v3HtmlVideoRunMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/html-video\/run-agent$/);
  if (request.method === "POST" && v3HtmlVideoRunMatch) {
    const paths = await resolveExistingProjectPaths(v3HtmlVideoRunMatch[1]);
    const body = await readJsonRequestBody(request);
    sendJson(response, await runHtmlVideoAgentForProject(paths, body));
    return;
  }

  const v3RevisionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/html-video\/revise$/);
  if (request.method === "POST" && v3RevisionMatch) {
    const paths = await resolveExistingProjectPaths(v3RevisionMatch[1]);
    const body = await readJsonRequestBody(request);
    sendJson(response, await reviseHtmlVideoProject(paths, body));
    return;
  }

  const previewMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/video-html\/preview$/);
  if (request.method === "GET" && previewMatch) {
    const smallProjectId = decodeURIComponent(previewMatch[1]);
    sendJson(response, await loadHtmlVideoPreviewModel(resolveSmallProjectPaths(storageRoot, smallProjectId)));
    return;
  }

  const v3PreviewMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/html-video\/preview$/);
  if (request.method === "GET" && v3PreviewMatch) {
    const paths = await resolveExistingProjectPaths(v3PreviewMatch[1]);
    sendJson(response, await loadHtmlVideoPreviewModel(paths));
    return;
  }

  const scheduleRecommendMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/images\/schedule\/recommend$/);
  if (request.method === "POST" && scheduleRecommendMatch) {
    const paths = await resolveExistingProjectPaths(scheduleRecommendMatch[1]);
    const body = await readJsonRequestBody(request);
    sendJson(response, await recommendImageScheduleForProject(paths, body));
    return;
  }

  if (request.method === "POST" && scheduleMatch) {
    const paths = await resolveExistingProjectPaths(scheduleMatch[1]);
    const body = await readJsonRequestBody(request);
    sendJson(response, await updateImageScheduleForProject(paths, body));
    return;
  }

  if (request.method === "POST" && promptGroupMatch) {
    const paths = await resolveExistingProjectPaths(promptGroupMatch[1]);
    const body = await readJsonRequestBody(request);
    sendJson(response, await updateImagePromptGroupForProject(paths, body));
    return;
  }

  const imageAssetActionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/images\/([^/]+)\/(lock|reject)$/);
  if (request.method === "POST" && imageAssetActionMatch) {
    const paths = await resolveExistingProjectPaths(imageAssetActionMatch[1]);
    const candidateId = decodeURIComponent(imageAssetActionMatch[2]);
    assertSafeRouteId(candidateId, "asset id");
    const body = await readJsonRequestBody(request);
    sendJson(response, await applyImageCandidateReviewAction(paths, imageAssetActionMatch[3] as "lock" | "reject", candidateId, body));
    return;
  }

  const imageSkipMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/images\/skip$/);
  if (request.method === "POST" && imageSkipMatch) {
    const paths = await resolveExistingProjectPaths(imageSkipMatch[1]);
    const body = await readJsonRequestBody(request);
    sendJson(response, await skipImageReview(paths, body));
    return;
  }

  const imageRunGenerationMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/images\/run-generation$/);
  if (request.method === "POST" && imageRunGenerationMatch) {
    const paths = await resolveExistingProjectPaths(imageRunGenerationMatch[1]);
    const body = await readJsonRequestBody(request);
    sendJson(response, await prepareImageGenerationRun(paths, body));
    return;
  }

  const sourceImportMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/source-video\/import$/);
  if (request.method === "POST" && sourceImportMatch) {
    const paths = await resolveExistingProjectPaths(sourceImportMatch[1]);
    const body = await readJsonRequestBody(request);
    sendJson(response, await importSourceVideoForProject(paths, body));
    return;
  }

  const exportRenderMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/export\/render$/);
  if (request.method === "POST" && exportRenderMatch) {
    const paths = await resolveExistingProjectPaths(exportRenderMatch[1]);
    const body = await readJsonRequestBody(request);
    sendJson(response, await renderExportForProject(paths, body));
    return;
  }

  const exportFinalMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/export\/final\.mp4$/);
  if (request.method === "GET" && exportFinalMatch) {
    const paths = await resolveExistingProjectPaths(exportFinalMatch[1]);
    await sendApiFile(response, paths.finalMp4Path, "video/mp4");
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

async function listApiProjects(): Promise<V3ProjectListResponse> {
  const projects: V3ProjectListItem[] = [];
  for (const smallProjectId of await listSmallProjectIds()) {
    const status = await readWorkbenchProjectStatus({ storageRoot, smallProjectId });
    projects.push(projectListItem(status));
  }
  return { projects };
}

function projectDetailResponse(status: WorkbenchProjectStatus): V3ProjectDetailResponse {
  return {
    project: projectListItem(status),
    status,
  };
}

function projectListItem(status: WorkbenchProjectStatus): V3ProjectListItem {
  return {
    small_project_id: status.small_project_id,
    mode: status.mode,
    status: status.overall_status,
    project_root: projectRootRelativePath(status.small_project_id),
  };
}

function projectRootRelativePath(smallProjectId: string): string {
  const root = path.resolve(storageRoot);
  return normalizePath(path.relative(path.dirname(root), path.join(root, smallProjectId)));
}

async function resolveExistingProjectPaths(rawProjectId: string): Promise<SmallProjectPaths> {
  let smallProjectId: string;
  try {
    smallProjectId = decodeURIComponent(rawProjectId);
  } catch {
    throw new ApiRouteError(400, "invalid_project_id", "Project id must be URL-decodable.");
  }

  let paths: SmallProjectPaths;
  try {
    paths = resolveSmallProjectPaths(storageRoot, smallProjectId);
  } catch (error) {
    throw new ApiRouteError(400, "invalid_project_id", error instanceof Error ? error.message : "Invalid project id.");
  }

  try {
    const projectStat = await stat(paths.projectRoot);
    if (!projectStat.isDirectory()) throw new ApiRouteError(404, "project_not_found", "Project not found.");
  } catch (error) {
    if (error instanceof ApiRouteError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ApiRouteError(404, "project_not_found", "Project not found.");
    }
    throw error;
  }
  return paths;
}

async function approveAnimationPlan(paths: SmallProjectPaths, body: Record<string, unknown>): Promise<AnimationPlanApprovalResponse> {
  const status = await readWorkbenchProjectStatus({ storageRoot, smallProjectId: paths.smallProjectId });
  if (!status.inputs.animation_plan.exists) {
    throw new ApiRouteError(409, "animation_plan_missing", "Animation Plan is required before it can be approved.");
  }
  if (body.approved !== undefined && body.approved !== true) {
    throw new ApiRouteError(400, "invalid_approval", "approved must be true when provided.");
  }

  const approval: AnimationPlanApprovalResponse = {
    approved: true,
    approved_at: new Date().toISOString(),
    approved_by: stringBodyValue(body.approved_by) ?? stringBodyValue(body.approvedBy) ?? "local-user",
    source: stringBodyValue(body.source) ?? "workbench",
  };
  const checkpointPath = path.join(paths.projectRoot, "workflow_checkpoints.json");
  const existing = await readOptionalRecord(checkpointPath) ?? {};
  const existingAnimationPlan = isRecord(existing.animation_plan) ? existing.animation_plan : {};
  await writeJson(checkpointPath, {
    ...existing,
    schema_version: existing.schema_version ?? 1,
    animation_plan: {
      ...existingAnimationPlan,
      ...approval,
    },
  });
  return approval;
}

async function imageArtifactsResponse(paths: SmallProjectPaths): Promise<ImageArtifactsResponse> {
  return {
    small_project_id: paths.smallProjectId,
    image_assets: await jsonArtifact(paths.projectRoot, "image_assets", ["data/storyboard/image_assets.json", "assets/image_assets.json"]),
    image_review_decisions: await jsonArtifact(paths.projectRoot, "image_review_decisions", ["data/storyboard/image_review_decisions.json", "assets/image_review_decisions.json"]),
  };
}

async function recommendImageScheduleForProject(paths: SmallProjectPaths, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  await assertAnimationPlanApproved(paths);
  const aspectRatio = imageScheduleAspectRatioValue(
    stringBodyValue(body.primary_ratio) ?? stringBodyValue(body.primaryRatio) ?? stringBodyValue(body.aspect_ratio) ?? stringBodyValue(body.aspectRatio),
  ) ?? await readPrimaryAspectRatio(paths) ?? "9:16";
  const written = await writeRecommendedImageGenerationSchedule({
    projectRoot: paths.projectRoot,
    smallProjectId: paths.smallProjectId,
    aspectRatio,
    targetSize: targetSizeForAspectRatio(aspectRatio),
  });
  const schedule = booleanBodyValue(body.confirm) === true
    ? { ...written.schedule, status: "confirmed" as const, items: written.schedule.items.map((item) => ({ ...item, status: item.skip ? item.status : "prompt_pending" as const })) }
    : written.schedule;
  if (schedule !== written.schedule) {
    await writeJson(path.join(paths.projectRoot, written.path), schedule);
  }
  return {
    small_project_id: paths.smallProjectId,
    image_generation_schedule: {
      path: written.path,
      data: schedule,
    },
  };
}

async function updateImageScheduleForProject(paths: SmallProjectPaths, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  await assertAnimationPlanApproved(paths);
  const schedule = recordBodyValue(body.schedule) ?? recordBodyValue(body.image_generation_schedule) ?? body;
  const sectionMap = await readSectionMapForImageSchedule(paths.projectRoot);
  const validation = validateImageGenerationSchedule({
    schedule,
    sectionMap: sectionMap.sectionMap,
    smallProjectId: paths.smallProjectId,
  });
  if (!validation.ok) throw new ApiRouteError(400, "invalid_image_schedule", validation.issues.join("; "));
  const relativePath = "data/storyboard/image_generation_schedule.json";
  await writeJson(path.join(paths.projectRoot, relativePath), schedule);
  return {
    small_project_id: paths.smallProjectId,
    image_generation_schedule: {
      path: relativePath,
      data: schedule,
    },
  };
}

async function updateImagePromptGroupForProject(paths: SmallProjectPaths, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  await assertAnimationPlanApproved(paths);
  const schedule = await readImageSchedule(paths);
  const provided = recordBodyValue(body.prompt_group) ?? recordBodyValue(body.promptGroup);
  const promptGroup = provided
    ? maybeConfirmPromptGroup(provided as ImagePromptGroup, body)
    : maybeConfirmPromptGroup(createImagePromptGroup({
      smallProjectId: paths.smallProjectId,
      schedule,
      styleId: stringBodyValue(body.style_id) ?? stringBodyValue(body.styleId) ?? "high_contrast_cyber_classroom",
      scenePrompts: stringRecordBodyValue(body.scene_prompts) ?? stringRecordBodyValue(body.scenePrompts),
      createdBy: stringBodyValue(body.created_by) ?? stringBodyValue(body.createdBy),
    }), body);
  const validation = validateImagePromptGroup({ promptGroup, schedule });
  if (!validation.ok) throw new ApiRouteError(400, "invalid_image_prompt_group", validation.issues.join("; "));
  const written = await writeImagePromptGroup({ projectRoot: paths.projectRoot, promptGroup });
  return {
    small_project_id: paths.smallProjectId,
    image_prompt_group: {
      path: written.path,
      data: written.promptGroup,
    },
  };
}

async function applyImageCandidateReviewAction(
  paths: SmallProjectPaths,
  action: Extract<ImageReviewAction, "lock" | "reject">,
  candidateId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const schedule = await readImageSchedule(paths);
  const promptGroup = await readImagePromptGroup(paths);
  const imageResults = await readImageGenerationResults(paths);
  const candidate = findGeneratedCandidate(imageResults, candidateId);
  if (!candidate) {
    throw new ApiRouteError(409, "image_candidate_missing", `Generated image candidate not found: ${candidateId}`);
  }
  const imageId = stringBodyValue(body.image_id) ?? stringBodyValue(body.imageId) ?? candidate.imageId;
  const promptItem = promptGroup.items.find((item) => item.image_id === imageId);
  const review = await readImageReviewDecisionFile(paths.projectRoot, paths.smallProjectId);
  const nextReview = applyImageReviewAction({
    review,
    action,
    imageId,
    candidateId,
    candidatePath: stringBodyValue(body.candidate_path) ?? stringBodyValue(body.candidatePath) ?? projectRelativeCandidatePath(paths, candidate.path),
    reason: stringBodyValue(body.reason),
    decidedBy: stringBodyValue(body.decided_by) ?? stringBodyValue(body.decidedBy),
    prompt: action === "lock" ? stringBodyValue(body.prompt) ?? promptItem?.final_prompt : undefined,
    sha256: action === "lock" ? stringBodyValue(body.sha256) ?? candidate.sha256 : undefined,
    width: action === "lock" ? positiveIntegerBodyValue(body.width, "width") ?? candidate.width : undefined,
    height: action === "lock" ? positiveIntegerBodyValue(body.height, "height") ?? candidate.height : undefined,
    provenance: action === "lock" ? recordBodyValue(body.provenance) ?? candidate.provenance : undefined,
  });
  const imageAssets = await writeValidatedReviewAndAssets({
    paths,
    review: nextReview,
    schedule,
    promptGroup,
    imageResults,
  });
  return {
    small_project_id: paths.smallProjectId,
    action,
    image_id: imageId,
    candidate_id: candidateId,
    image_review_decisions: {
      path: "data/storyboard/image_review_decisions.json",
      data: nextReview,
    },
    image_assets: {
      path: imageAssets.path,
      data: imageAssets.imageAssets,
    },
  };
}

async function skipImageReview(paths: SmallProjectPaths, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const imageId = stringBodyValue(body.image_id) ?? stringBodyValue(body.imageId);
  if (!imageId) throw new ApiRouteError(400, "invalid_image_id", "image_id is required.");
  const schedule = markScheduleImageSkipped(await readImageSchedule(paths), imageId);
  await writeJson(path.join(paths.projectRoot, "data/storyboard/image_generation_schedule.json"), schedule);
  const promptGroup = await readOptionalImagePromptGroup(paths) ?? emptyPromptGroup(paths.smallProjectId);
  const imageResults = await readImageGenerationResults(paths);
  const review = await readImageReviewDecisionFile(paths.projectRoot, paths.smallProjectId);
  const nextReview = applyImageReviewAction({
    review,
    action: "skip",
    imageId,
    reason: stringBodyValue(body.reason),
    decidedBy: stringBodyValue(body.decided_by) ?? stringBodyValue(body.decidedBy),
  });
  const imageAssets = await writeValidatedReviewAndAssets({
    paths,
    review: nextReview,
    schedule,
    promptGroup,
    imageResults,
  });
  return {
    small_project_id: paths.smallProjectId,
    action: "skip",
    image_id: imageId,
    image_review_decisions: {
      path: "data/storyboard/image_review_decisions.json",
      data: nextReview,
    },
    image_generation_schedule: {
      path: "data/storyboard/image_generation_schedule.json",
      data: schedule,
    },
    image_assets: {
      path: imageAssets.path,
      data: imageAssets.imageAssets,
    },
  };
}

async function prepareImageGenerationRun(paths: SmallProjectPaths, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const imageId = stringBodyValue(body.image_id) ?? stringBodyValue(body.imageId);
  if (!imageId) throw new ApiRouteError(400, "invalid_image_id", "image_id is required.");
  const schedule = await readImageSchedule(paths);
  const promptGroup = await readImagePromptGroup(paths);
  const imageResults = await readImageGenerationResults(paths);
  const scenePromptOverride = stringBodyValue(body.prompt_override) ?? stringBodyValue(body.promptOverride);
  const request = buildRegenerationImageRequest({
    imageId,
    schedule,
    promptGroup,
    outputDir: path.join(paths.projectRoot, "assets", "images", "generated"),
    variants: positiveIntegerBodyValue(body.variants, "variants"),
    promptOverride: scenePromptOverride,
  });
  const review = await readImageReviewDecisionFile(paths.projectRoot, paths.smallProjectId);
  const nextReview = applyImageReviewAction({
    review,
    action: "regenerate",
    imageId,
    reason: stringBodyValue(body.reason),
    decidedBy: stringBodyValue(body.decided_by) ?? stringBodyValue(body.decidedBy),
    regeneratePromptOverride: scenePromptOverride,
  });
  const validation = validateImageReviewDecisionFile({
    review: nextReview,
    smallProjectId: paths.smallProjectId,
    schedule,
    promptGroup,
    imageResults,
    projectRoot: paths.projectRoot,
  });
  if (!validation.ok) throw new ApiRouteError(409, "image_review_invalid", validation.issues.join("; "));
  await writeImageReviewDecisionFile({ projectRoot: paths.projectRoot, review: nextReview });
  return {
    small_project_id: paths.smallProjectId,
    action: "regenerate",
    image_id: imageId,
    image_generation_request: request,
    image_review_decisions: {
      path: "data/storyboard/image_review_decisions.json",
      data: nextReview,
    },
  };
}

async function importSourceVideoForProject(paths: SmallProjectPaths, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const result = await importSourceVideoAsset({
      projectRoot: paths.projectRoot,
      smallProjectId: paths.smallProjectId,
      sourcePath: stringBodyValue(body.source_path) ?? stringBodyValue(body.sourcePath) ?? stringBodyValue(body.path),
      copyToProject: booleanBodyValue(body.copy_to_project) ?? booleanBodyValue(body.copyToProject),
      destinationPath: stringBodyValue(body.destination_path) ?? stringBodyValue(body.destinationPath),
    });
    return {
      small_project_id: paths.smallProjectId,
      source_video_import: {
        path: result.path,
        data: result.importFile,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /remote url/i.test(message) || /mp4 files only/i.test(message) ? 400 : 409;
    throw new ApiRouteError(status, "source_video_import_failed", message);
  }
}

async function runHtmlVideoAgentForProject(paths: SmallProjectPaths, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  await assertAnimationPlanApproved(paths);
  const plan = await readAnimationPlanForHtmlVideo(paths);
  const sourceVideoImport = await readFirstProjectJson<SourceVideoImportFile>(paths, ["data/source/source_video_import.json"]);
  const contentGraph = animationPlanToContentGraph(plan);
  const frameContracts = withProjectAudioPolicy(paths, buildFrameContracts({ plan, paths }), sourceVideoImport);
  await ensureHtmlVideoWorkspace({
    paths,
    animationPlan: plan,
    contentGraph,
    frameContracts,
  });
  await writeAgentContextForProject(paths, plan, sourceVideoImport);
  await stageSourceVideoForFrames(paths, sourceVideoImport);
  await writeFile(paths.codexPromptPath, buildCodexFrameAgentPrompt({
    smallProjectId: paths.smallProjectId,
    agentContextPath: "codex/agent_context.json",
    contentGraphPath: "content-graph.json",
    frameContractsPath: "qivance-frame-contracts.json",
  }), "utf8");

  const startedAt = new Date().toISOString();
  const before = await snapshotFiles(paths.htmlVideoProjectDir);
  const runtime = await runProductionAgentRuntime(paths, paths.codexPromptPath, body);
  await writeJson(path.join(paths.codexDir, "html-video-runtime-result.json"), runtime);
  const finishedAt = new Date().toISOString();
  const changedFiles = diffSnapshots(before, await snapshotFiles(paths.htmlVideoProjectDir));
  const forbiddenChangedFiles = forbiddenPathChanges(changedFiles);
  const frameValidation = await validateFrameOutputs({
    framesDir: paths.framesDir,
    contracts: frameContracts,
    allowedLocalImagePaths: await allowedLocalImagePaths(paths),
    allowedLocalVideoPaths: await allowedLocalVideoPaths(paths),
  });
  const log = buildAgentRunLog({
    smallProjectId: paths.smallProjectId,
    mode: "production",
    operation: "run_agent",
    startedAt,
    finishedAt,
    exitCode: runtime.exitCode,
    timedOut: runtime.timedOut,
    changedFiles,
    frameValidation: { passed: frameValidation.ok, issues: frameValidation.issues },
    forbiddenChangedFiles,
    diagnostics: runtimeDiagnostics(runtime),
  });
  const agentRun = await writeAgentRunLog({ paths, log });

  if (!log.validation.passed) {
    throw new ApiRouteError(409, "html_video_agent_failed", log.validation.issues.join("; "));
  }
  await syncProjectFramesFromContracts(paths, frameContracts);
  return {
    small_project_id: paths.smallProjectId,
    agent_run: {
      path: agentRun.path,
      data: agentRun.log,
    },
    preview: await loadHtmlVideoPreviewModel(paths),
  };
}

async function renderExportForProject(paths: SmallProjectPaths, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  await assertAnimationPlanApproved(paths);
  await stageSourceVideoForFrames(paths, await readFirstProjectJson<SourceVideoImportFile>(paths, ["data/source/source_video_import.json"]));
  const visualPath = path.join(paths.exportsDir, "visual_silent.mp4");
  await renderHtmlVideoVisual({ paths, outputPath: visualPath });
  const audioSource = await renderAudioSource(paths);
  await muxLockedAudio({
    visualMp4Path: visualPath,
    masterAudioPath: audioSource,
    finalMp4Path: paths.finalMp4Path,
  });
  const manifest = await buildRenderManifestV3ForProject(paths, {
    diagnosticFlagsUsed: stringArrayBodyValue(body.diagnostic_flags_used) ?? stringArrayBodyValue(body.diagnosticFlagsUsed) ?? [],
  });
  await writeJson(paths.renderManifestPath, manifest);
  return {
    small_project_id: paths.smallProjectId,
    visual_mp4: {
      path: "exports/visual_silent.mp4",
      sha256: await sha256File(visualPath),
    },
    final_mp4: {
      path: "exports/final.mp4",
      sha256: await sha256File(paths.finalMp4Path),
    },
    render_manifest: {
      path: "exports/render_manifest.json",
      data: manifest,
    },
  };
}

async function reviseHtmlVideoProject(paths: SmallProjectPaths, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let revision;
  try {
    revision = createRevisionRequest({ smallProjectId: paths.smallProjectId, body });
  } catch (error) {
    throw new ApiRouteError(400, "invalid_revision_request", error instanceof Error ? error.message : String(error));
  }
  await writeRevisionRequest({ projectRoot: paths.projectRoot, revision });
  await mkdir(paths.codexDir, { recursive: true });
  const promptPath = path.join(paths.codexDir, `${revision.revision_id}.md`);
  await writeFile(promptPath, buildRevisionPrompt(revision), "utf8");
  await stageSourceVideoForFrames(paths, await readFirstProjectJson<SourceVideoImportFile>(paths, ["data/source/source_video_import.json"]));

  const startedAt = new Date().toISOString();
  const before = await snapshotFiles(paths.htmlVideoProjectDir);
  const runtime = await runRevisionRuntime(paths, promptPath);
  await writeJson(path.join(paths.codexDir, `${revision.revision_id}-runtime-result.json`), runtime);
  const finishedAt = new Date().toISOString();
  const changedFiles = diffSnapshots(before, await snapshotFiles(paths.htmlVideoProjectDir));
  const forbiddenChangedFiles = forbiddenPathChanges(changedFiles);
  const contracts = await readRequiredJsonFile<QivanceFrameContracts>(
    paths.frameContractsPath,
    "frame_contracts_missing",
    "qivance-frame-contracts.json is required before revision.",
  );
  const frameValidation = await validateFrameOutputs({
    framesDir: paths.framesDir,
    contracts,
    allowedLocalImagePaths: await allowedLocalImagePaths(paths),
    allowedLocalVideoPaths: await allowedLocalVideoPaths(paths),
  });
  const log = buildAgentRunLog({
    smallProjectId: paths.smallProjectId,
    mode: "production",
    operation: "revise",
    scope: revision.scope,
    inputArtifacts: ["content-graph.json", "qivance-frame-contracts.json", "codex/agent_context.json", "revision_request.json"],
    startedAt,
    finishedAt,
    exitCode: runtime.exitCode,
    timedOut: runtime.timedOut,
    changedFiles,
    frameValidation: { passed: frameValidation.ok, issues: frameValidation.issues },
    forbiddenChangedFiles,
    diagnostics: runtimeDiagnostics(runtime),
  });
  const agentRun = await writeAgentRunLog({ paths, log });

  if (!log.validation.passed) {
    const failed = withRevisionStatus(revision, "failed");
    await writeRevisionRequest({ projectRoot: paths.projectRoot, revision: failed });
    throw new ApiRouteError(409, "revision_failed", log.validation.issues.join("; "));
  }

  const succeeded = withRevisionStatus(revision, "succeeded");
  await writeRevisionRequest({ projectRoot: paths.projectRoot, revision: succeeded });
  return {
    small_project_id: paths.smallProjectId,
    revision_request: {
      path: "revision_request.json",
      data: succeeded,
    },
    agent_run: {
      path: agentRun.path,
      data: agentRun.log,
    },
    preview: await loadHtmlVideoPreviewModel(paths),
  };
}

async function assertAnimationPlanApproved(paths: SmallProjectPaths): Promise<void> {
  const status = await readWorkbenchProjectStatus({ storageRoot, smallProjectId: paths.smallProjectId });
  if (!status.inputs.animation_plan.exists) {
    throw new ApiRouteError(409, "animation_plan_missing", "Animation Plan is required before this production action.");
  }
  if (!status.inputs.animation_plan.approved) {
    throw new ApiRouteError(409, "animation_plan_unapproved", "Animation Plan must be approved before this production action.");
  }
}

async function readAnimationPlanForHtmlVideo(paths: SmallProjectPaths): Promise<AnimationPlan> {
  const raw = await readFirstProjectJson<Record<string, unknown>>(paths, ["animation_plan.json", "qivance/animation_plan.json"]);
  if (!raw) throw new ApiRouteError(409, "animation_plan_missing", "Animation Plan is required before html-video production.");
  const plan = normalizeAnimationPlan(raw, paths.smallProjectId);
  return attachLockedSceneAssets(plan, await readLockedImageAssets(paths), await readFirstProjectJson<SourceVideoImportFile>(paths, ["data/source/source_video_import.json"]));
}

function normalizeAnimationPlan(raw: Record<string, unknown>, smallProjectId: string): AnimationPlan {
  if (raw.schemaVersion === 1 && Array.isArray(raw.scenes)) {
    return raw as AnimationPlan;
  }
  if (raw.schema_version !== 1 || !Array.isArray(raw.scenes)) {
    throw new ApiRouteError(409, "animation_plan_invalid", "Animation Plan must use schema_version/schemaVersion 1 with scenes[].");
  }
  const aspectRatio = qivanceAspectRatioValue(raw.aspect_ratio) ?? "9:16";
  const resolution = isRecord(raw.resolution) ? raw.resolution : {};
  const scenes = raw.scenes.map((scene, index) => {
    if (!isRecord(scene)) throw new ApiRouteError(409, "animation_plan_invalid", `animation_plan.scenes[${index}] must be an object.`);
    const sceneId = stringBodyValue(scene.scene_id) ?? stringBodyValue(scene.id) ?? `scene_${String(index + 1).padStart(3, "0")}`;
    const startSec = finiteNumberValue(scene.start_sec) ?? finiteNumberValue(scene.startSec);
    const endSec = finiteNumberValue(scene.end_sec) ?? finiteNumberValue(scene.endSec);
    if (startSec === undefined || endSec === undefined || endSec <= startSec) {
      throw new ApiRouteError(409, "animation_plan_invalid", `${sceneId} must include a valid start/end range.`);
    }
    const sectionIds = stringArrayBodyValue(scene.section_ids) ?? stringArrayBodyValue(scene.sectionIds) ?? [];
    const imageGeneration = isRecord(scene.image_generation) ? scene.image_generation : {};
    const imageEnabled = imageGeneration.enabled === true;
    return {
      id: sceneId,
      order: Number.isInteger(scene.order) ? Number(scene.order) : index,
      sectionId: sectionIds[0] ?? stringBodyValue(scene.section_id) ?? sceneId,
      startSec,
      endSec,
      durationSec: round(endSec - startSec),
      frameIntent: imageEnabled ? "generated background scene" : "lyric-driven motion scene",
      headline: stringBodyValue(scene.headline) ?? sectionIds[0] ?? sceneId,
      bodyLines: [],
      captionMode: "line_caption" as const,
      visualDirectives: imageEnabled ? ["use locked generated background"] : ["no external media"],
      beatSync: { intensity: imageEnabled ? 0.8 : 0.55 },
    };
  });
  return {
    schemaVersion: 1,
    smallProjectId: stringBodyValue(raw.small_project_id) ?? stringBodyValue(raw.smallProjectId) ?? smallProjectId,
    title: stringBodyValue(raw.title) ?? smallProjectId,
    category: "ai_concept",
    targetDurationSec: finiteNumberValue(raw.duration_sec) ?? finiteNumberValue(raw.targetDurationSec) ?? round(scenes.reduce((sum, scene) => sum + scene.durationSec, 0)),
    fps: finiteNumberValue(raw.fps) ?? 30,
    resolution: {
      width: positiveIntegerPlainValue(resolution.width) ?? (aspectRatio === "16:9" ? 1920 : 1080),
      height: positiveIntegerPlainValue(resolution.height) ?? (aspectRatio === "16:9" ? 1080 : 1920),
    },
    aspectRatio,
    mood: stringBodyValue(raw.mood) ?? "production",
    synopsis: stringBodyValue(raw.synopsis) ?? "Qivance V3 product flow",
    scenes,
  };
}

async function readLockedImageAssets(paths: SmallProjectPaths): Promise<Array<{ scene_id?: string; asset_id?: string; path?: string; role?: string; status?: string }>> {
  const value = await readFirstProjectJson<unknown>(paths, ["data/storyboard/image_assets.json", "assets/image_assets.json"]);
  if (!isRecord(value) || !Array.isArray(value.assets)) return [];
  return value.assets.filter((asset): asset is { scene_id?: string; asset_id?: string; path?: string; role?: string; status?: string } => isRecord(asset));
}

function attachLockedSceneAssets(
  plan: AnimationPlan,
  imageAssets: Array<{ scene_id?: string; asset_id?: string; path?: string; role?: string; status?: string }>,
  sourceVideoImport: SourceVideoImportFile | null,
): AnimationPlan {
  return {
    ...plan,
    scenes: plan.scenes.map((scene) => {
      const assets: NonNullable<AnimationPlan["scenes"][number]["assets"]> = imageAssets
        .filter((asset) => asset.status === "locked" && asset.scene_id === scene.id && asset.asset_id && asset.path)
        .map((asset) => ({
          id: asset.asset_id!,
          type: "image" as const,
          path: asset.path!,
          role: asset.role,
        }));
      if (sourceVideoImport && sourceVideoImport.status === "locked") {
        assets.push({
          id: "locked_source_video",
          type: "video" as const,
          path: sourceVideoImport.source_video.path,
          role: "source_video",
        });
      }
      return assets.length > 0 ? { ...scene, assets } : scene;
    }),
  };
}

function withProjectAudioPolicy(
  paths: SmallProjectPaths,
  contracts: QivanceFrameContracts,
  sourceVideoImport: SourceVideoImportFile | null,
): QivanceFrameContracts {
  if (sourceVideoImport) return { ...contracts, masterAudioPath: sourceVideoImport.source_video.path };
  return { ...contracts, masterAudioPath: projectAudioRelativePath(paths) };
}

async function writeAgentContextForProject(
  paths: SmallProjectPaths,
  plan: AnimationPlan,
  sourceVideoImport: SourceVideoImportFile | null,
): Promise<void> {
  const context = buildAgentContext({
    plan,
    paths,
    ...(sourceVideoImport ? { sourceVideoImport } : {}),
  });
  context.sourceFiles.masterAudio = sourceVideoImport ? sourceVideoImport.source_video.path : `../../../${projectAudioRelativePath(paths)}`;
  await writeJson(paths.codexAgentContextPath, context);
}

async function runProductionAgentRuntime(
  paths: SmallProjectPaths,
  promptPath: string,
  body: Record<string, unknown>,
): Promise<Awaited<ReturnType<typeof runHtmlVideoAgentRuntime>>> {
  try {
    return await runHtmlVideoAgentRuntime({
      projectDir: paths.htmlVideoProjectDir,
      promptPath,
      agentId: stringBodyValue(body.agent_id) ?? stringBodyValue(body.agentId) ?? "codex",
      model: stringBodyValue(body.model) ?? process.env.QIVANCE_HTML_VIDEO_MODEL,
      timeoutMs: positiveIntegerBodyValue(body.timeout_ms, "timeout_ms") ?? positiveIntegerBodyValue(body.timeoutMs, "timeoutMs") ?? parseOptionalPositiveInt(process.env.QIVANCE_HTML_VIDEO_RUNTIME_TIMEOUT_MS) ?? 2 * 60 * 1000,
    });
  } catch (error) {
    return {
      agentId: stringBodyValue(body.agent_id) ?? stringBodyValue(body.agentId) ?? "codex",
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

function runtimeDiagnostics(runtime: Awaited<ReturnType<typeof runHtmlVideoAgentRuntime>>): string[] {
  const diagnostics: string[] = [];
  if (runtime.stderr.trim()) diagnostics.push(`stderr: ${truncateDiagnosticOutput(runtime.stderr)}`);
  if (runtime.stdout.trim()) diagnostics.push(`stdout: ${truncateDiagnosticOutput(runtime.stdout)}`);
  return diagnostics;
}

function truncateDiagnosticOutput(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 2000 ? `${trimmed.slice(0, 2000)}...` : trimmed;
}

async function syncProjectFramesFromContracts(paths: SmallProjectPaths, contracts: QivanceFrameContracts): Promise<void> {
  const store = new ProjectStore(paths.htmlVideoRoot);
  const project = await store.load(paths.smallProjectId);
  const frames = Object.values(contracts.frames)
    .sort((a, b) => a.order - b.order)
    .map((contract) => ({
      graphNodeId: contract.graphNodeId,
      htmlPath: `${paths.htmlVideoProjectDir}/${contract.allowedHtmlPath}`,
      durationSec: contract.durationSec,
      order: contract.order,
    }));
  const nextProject: Project = {
    ...project,
    frames,
    lastPreviewHtmlPath: frames[0]?.htmlPath,
    status: "previewed",
    updatedAt: new Date().toISOString(),
  };
  await store.save(nextProject);
}

async function renderAudioSource(paths: SmallProjectPaths): Promise<string> {
  const sourceVideoImport = await readFirstProjectJson<SourceVideoImportFile>(paths, ["data/source/source_video_import.json"]);
  if (sourceVideoImport) return path.join(paths.projectRoot, sourceVideoImport.source_video.path);
  return path.join(paths.projectRoot, projectAudioRelativePath(paths));
}

async function buildRenderManifestV3ForProject(
  paths: SmallProjectPaths,
  input: { diagnosticFlagsUsed: string[] },
) {
  const status = await readWorkbenchProjectStatus({ storageRoot, smallProjectId: paths.smallProjectId });
  const projectMode = renderManifestProjectMode(status.mode);
  const primaryRatio = qivanceAspectRatioValue(status.primary_ratio) ?? await readPrimaryAspectRatio(paths) ?? "9:16";
  const sourceVideoImport = await readFirstProjectJson<SourceVideoImportFile>(paths, ["data/source/source_video_import.json"]);
  const manifest = buildRenderManifestV3({
    smallProjectId: paths.smallProjectId,
    primaryRatio,
    projectMode,
    ...(projectMode === "image_music_mode" ? {
      imageSchedule: await evidenceRef(paths, "data/storyboard/image_generation_schedule.json"),
      imagePromptGroup: await evidenceRef(paths, "data/storyboard/image_prompt_group.json"),
      imageReviewDecisions: await evidenceRef(paths, "data/storyboard/image_review_decisions.json"),
    } : {}),
    agentRuns: await agentRunEvidenceRefs(paths),
    ...(sourceVideoImport ? {
      sourceVideo: {
        enabled: true as const,
        ...await evidenceRef(paths, "data/source/source_video_import.json"),
        audio_policy: sourceVideoImport.audio_policy,
        final_audio_source: sourceVideoImport.source_video.path,
        source_mp4_sha256: sourceVideoImport.source_video.sha256,
        ffprobe: sourceVideoImport.source_video.ffprobe,
      },
    } : {}),
    diagnosticFlagsUsed: input.diagnosticFlagsUsed,
  });
  const validation = validateRenderManifestV3(manifest);
  if (!validation.ok) throw new ApiRouteError(409, "render_manifest_v3_invalid", validation.issues.join("; "));
  return manifest;
}

async function agentRunEvidenceRefs(paths: SmallProjectPaths): Promise<RenderManifestV3AgentRunRef[]> {
  const agentRunDir = path.join(paths.htmlVideoProjectDir, "agent_runs");
  let filenames: string[];
  try {
    filenames = await readdir(agentRunDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const refs: RenderManifestV3AgentRunRef[] = [];
  for (const filename of filenames.filter((name) => name.endsWith(".json")).sort()) {
    const absolutePath = path.join(agentRunDir, filename);
    const parsed = JSON.parse(await readFile(absolutePath, "utf8")) as { mode?: "production" | "diagnostic"; ai_authored_frame_paths?: unknown[] };
    refs.push({
      path: `video/html-video/.html-video/projects/${paths.smallProjectId}/agent_runs/${filename}`,
      sha256: await sha256File(absolutePath),
      mode: parsed.mode ?? "diagnostic",
      ai_authored_frame_count: Array.isArray(parsed.ai_authored_frame_paths) ? parsed.ai_authored_frame_paths.length : 0,
    });
  }
  return refs;
}

async function evidenceRef(paths: SmallProjectPaths, relativePath: string): Promise<{ path: string; sha256: string }> {
  return {
    path: relativePath,
    sha256: await sha256File(path.join(paths.projectRoot, relativePath)),
  };
}

async function writeValidatedReviewAndAssets(input: {
  paths: SmallProjectPaths;
  review: Awaited<ReturnType<typeof readImageReviewDecisionFile>>;
  schedule: ImageGenerationSchedule;
  promptGroup: ImagePromptGroup;
  imageResults: ImageGenerationResult[];
}): Promise<Awaited<ReturnType<typeof writeLockedImageAssetsFromReview>>> {
  const validation = validateImageReviewDecisionFile({
    review: input.review,
    smallProjectId: input.paths.smallProjectId,
    schedule: input.schedule,
    promptGroup: input.promptGroup,
    imageResults: input.imageResults,
    projectRoot: input.paths.projectRoot,
  });
  if (!validation.ok) throw new ApiRouteError(409, "image_review_invalid", validation.issues.join("; "));
  await writeImageReviewDecisionFile({ projectRoot: input.paths.projectRoot, review: input.review });
  return await writeLockedImageAssetsFromReview({
    projectRoot: input.paths.projectRoot,
    smallProjectId: input.paths.smallProjectId,
    review: input.review,
    schedule: input.schedule,
    promptGroup: input.promptGroup,
    imageResults: input.imageResults,
  });
}

async function jsonArtifactResponse(paths: SmallProjectPaths, id: string, relativePath: string): Promise<JsonArtifactResponse> {
  return {
    small_project_id: paths.smallProjectId,
    artifact: await jsonArtifact(paths.projectRoot, id, [relativePath]),
  };
}

async function jsonArtifact(projectRoot: string, id: string, candidates: string[]): Promise<JsonArtifactResponse["artifact"]> {
  for (const candidate of candidates) {
    const absolutePath = path.join(projectRoot, candidate);
    try {
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile()) continue;
      return {
        id,
        exists: true,
        path: normalizePath(candidate),
        data: JSON.parse(await readFile(absolutePath, "utf8")),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return { id, exists: false, path: normalizePath(candidates[0]) };
}

async function readImageSchedule(paths: SmallProjectPaths): Promise<ImageGenerationSchedule> {
  return await readRequiredProjectJson(
    paths,
    "data/storyboard/image_generation_schedule.json",
    "image_schedule_missing",
    "Image generation schedule is required for image review actions.",
  );
}

async function readImagePromptGroup(paths: SmallProjectPaths): Promise<ImagePromptGroup> {
  return await readRequiredProjectJson(
    paths,
    "data/storyboard/image_prompt_group.json",
    "image_prompt_group_missing",
    "Confirmed image prompt group is required for image review actions.",
  );
}

async function readOptionalImagePromptGroup(paths: SmallProjectPaths): Promise<ImagePromptGroup | null> {
  return await readFirstProjectJson(paths, ["data/storyboard/image_prompt_group.json"]);
}

async function readImageGenerationResults(paths: SmallProjectPaths): Promise<ImageGenerationResult[]> {
  const value = await readFirstProjectJson<unknown>(paths, [
    "data/storyboard/image_generation_results.json",
    "assets/image_generation_results.json",
  ]);
  if (!value) return [];
  if (Array.isArray(value)) return value as ImageGenerationResult[];
  if (isRecord(value) && Array.isArray(value.results)) return value.results as ImageGenerationResult[];
  throw new ApiRouteError(409, "image_generation_results_invalid", "image_generation_results must be an array or contain results[].");
}

async function readRequiredProjectJson<T>(
  paths: SmallProjectPaths,
  relativePath: string,
  missingCode: string,
  missingMessage: string,
): Promise<T> {
  try {
    return JSON.parse(await readFile(path.join(paths.projectRoot, relativePath), "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ApiRouteError(409, missingCode, missingMessage);
    }
    if (error instanceof SyntaxError) {
      throw new ApiRouteError(409, "invalid_project_json", `${relativePath} must contain valid JSON.`);
    }
    throw error;
  }
}

async function readFirstProjectJson<T>(paths: SmallProjectPaths, candidates: string[]): Promise<T | null> {
  for (const relativePath of candidates) {
    try {
      return JSON.parse(await readFile(path.join(paths.projectRoot, relativePath), "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      if (error instanceof SyntaxError) {
        throw new ApiRouteError(409, "invalid_project_json", `${relativePath} must contain valid JSON.`);
      }
      throw error;
    }
  }
  return null;
}

async function readRequiredJsonFile<T>(filePath: string, missingCode: string, missingMessage: string): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ApiRouteError(409, missingCode, missingMessage);
    }
    if (error instanceof SyntaxError) {
      throw new ApiRouteError(409, "invalid_project_json", `${path.basename(filePath)} must contain valid JSON.`);
    }
    throw error;
  }
}

async function runRevisionRuntime(
  paths: SmallProjectPaths,
  promptPath: string,
): Promise<Awaited<ReturnType<typeof runHtmlVideoAgentRuntime>>> {
  try {
    return await runHtmlVideoAgentRuntime({
      projectDir: paths.htmlVideoProjectDir,
      promptPath,
      agentId: "codex",
      timeoutMs: parseOptionalPositiveInt(process.env.QIVANCE_HTML_VIDEO_RUNTIME_TIMEOUT_MS) ?? 2 * 60 * 1000,
    });
  } catch (error) {
    return {
      agentId: "codex",
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

function forbiddenPathChanges(changedFiles: string[]): string[] {
  try {
    assertAllowedPathChanges(changedFiles);
    return [];
  } catch (error) {
    if (error instanceof CodexForbiddenFileChangeError) return error.changedFiles;
    throw error;
  }
}

async function allowedLocalImagePaths(paths: SmallProjectPaths): Promise<string[]> {
  const value = await readFirstProjectJson<unknown>(paths, ["data/storyboard/image_assets.json", "assets/image_assets.json"]);
  const assets = isRecord(value) && Array.isArray(value.assets) ? value.assets : [];
  return assets.flatMap((asset) => {
    if (!isRecord(asset) || asset.status !== "locked") return [];
    const assetPath = stringBodyValue(asset.path);
    return assetPath ? [assetPath] : [];
  });
}

async function allowedLocalVideoPaths(paths: SmallProjectPaths): Promise<string[]> {
  const value = await readFirstProjectJson<unknown>(paths, ["data/source/source_video_import.json"]);
  if (!isRecord(value) || value.status !== "locked") return [];
  const sourceVideo = isRecord(value.source_video) ? value.source_video : null;
  const sourcePath = stringBodyValue(sourceVideo?.path);
  return sourcePath ? [safeFrameAssetRelativePath(sourcePath)] : [];
}

async function stageSourceVideoForFrames(paths: SmallProjectPaths, sourceVideoImport: SourceVideoImportFile | null): Promise<void> {
  if (!sourceVideoImport || sourceVideoImport.status !== "locked") return;
  const relativePath = safeFrameAssetRelativePath(sourceVideoImport.source_video.path);
  const sourcePath = path.join(paths.projectRoot, sourceVideoImport.source_video.path);
  const frameAssetPath = path.join(paths.framesDir, relativePath);
  await mkdir(path.dirname(frameAssetPath), { recursive: true });
  await copyFile(sourcePath, frameAssetPath);
}

function safeFrameAssetRelativePath(value: string): string {
  if (path.isAbsolute(value) || value.split(/[\\/]+/).includes("..")) {
    throw new ApiRouteError(409, "source_video_path_invalid", "Source video path must be project-relative for frame staging.");
  }
  return normalizePath(path.normalize(value));
}

function findGeneratedCandidate(
  results: ImageGenerationResult[],
  candidateId: string,
): (ImageGenerationResult["candidates"][number] & { requestId: string; imageId: string }) | null {
  for (const result of results) {
    for (const candidate of result.candidates) {
      if (candidate.candidateId === candidateId) {
        const imageId = result.requestId.replace(/^regen_/, "");
        return { ...candidate, requestId: result.requestId, imageId };
      }
    }
  }
  return null;
}

function markScheduleImageSkipped(schedule: ImageGenerationSchedule, imageId: string): ImageGenerationSchedule {
  let found = false;
  const items = schedule.items.map((item) => {
    if (item.image_id !== imageId) return item;
    found = true;
    return {
      ...item,
      status: "skipped" as const,
      skip: true,
      requires_prompt: false,
      requires_generation: false,
    };
  });
  if (!found) throw new ApiRouteError(404, "image_not_found", `Schedule image not found: ${imageId}`);
  return { ...schedule, items };
}

function emptyPromptGroup(smallProjectId: string): ImagePromptGroup {
  return {
    schema_version: 1,
    small_project_id: smallProjectId,
    style: { style_id: "empty", label: "empty", style_prompt: "empty", source: "preset" },
    status: "draft",
    items: [],
    provenance: { created_by: "workbench", llm_assisted: false },
  };
}

function projectRelativeCandidatePath(paths: SmallProjectPaths, candidatePath: string): string {
  const projectRoot = path.resolve(paths.projectRoot);
  const absolutePath = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(projectRoot, candidatePath);
  if (absolutePath !== projectRoot && !absolutePath.startsWith(projectRoot + path.sep)) {
    throw new ApiRouteError(409, "image_candidate_outside_project", "Generated image candidate must be inside the project root.");
  }
  return normalizePath(path.relative(projectRoot, absolutePath));
}

function buildRevisionPrompt(revision: ReturnType<typeof createRevisionRequest>): string {
  return [
    "You are revising an existing qivance html-video project.",
    "Make exactly one production revision matching the user request.",
    "Read qivance-frame-contracts.json before editing and keep every frame aligned to its contract.",
    "Edit only frame HTML files under frames/ and supporting codex/ or qa/ files.",
    "Do not use network assets. Do not change project.json, content-graph.json, or qivance-frame-contracts.json.",
    "If codex/agent_context.json has sourceVideo.enabled=true, keep the exact sourceVideo.path as a local <video> or <source> src in at least one frame.",
    "Do not rewrite sourceVideo.path into a parent-relative path; use the exact path from agent_context.",
    "Prefer the smallest valid edit that satisfies the request; do not redesign unrelated scenes.",
    "Every edited frame must keep a machine-parseable metadata assignment.",
    "Use exactly this shape with double-quoted JSON keys and string values so JSON.parse succeeds:",
    `<script>window.__QIVANCE_FRAME = {"graphNodeId":"scene_id","sceneId":"scene_id","durationSec":8,"durationPolicy":"strict"};</script>`,
    "Use the exact graphNodeId, sceneId, and durationSec from that frame's contract.",
    "When the requested revision has been written, stop refining, print DONE, and exit.",
    "",
    `Scope: ${JSON.stringify(revision.scope)}`,
    `Request: ${revision.request}`,
  ].join("\n");
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

async function sendApiFile(response: ServerResponse, absolutePath: string, type: string): Promise<void> {
  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      sendApiError(response, 404, "file_not_found", "File not found.");
      return;
    }
  } catch {
    sendApiError(response, 404, "file_not_found", "File not found.");
    return;
  }
  response.writeHead(200, { "content-type": type });
  createReadStream(absolutePath).pipe(response);
}

async function readJsonRequestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of request) {
    raw += String(chunk);
    if (raw.length > 1024 * 1024) {
      throw new ApiRouteError(413, "request_too_large", "JSON request body must be 1 MiB or smaller.");
    }
  }
  if (raw.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiRouteError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!isRecord(parsed)) {
    throw new ApiRouteError(400, "invalid_json_body", "Request body must be a JSON object.");
  }
  return parsed;
}

async function readOptionalRecord(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (!isRecord(parsed)) {
      throw new ApiRouteError(500, "invalid_project_metadata", `${path.basename(filePath)} must contain a JSON object.`);
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

function sendJson(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendApiError(response: ServerResponse, status: number, code: string, message: string): void {
  sendJson(response, { error: { code, message } }, status);
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

function assertSafeRouteId(value: string, label: string): void {
  if (!/^[a-zA-Z0-9_.-]+$/.test(value)) {
    throw new ApiRouteError(400, "invalid_route_parameter", `${label} may only contain letters, numbers, underscores, hyphens, and periods.`);
  }
}

function stringBodyValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function positiveIntegerBodyValue(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  throw new ApiRouteError(400, "invalid_request_body", `${label} must be a positive integer when provided.`);
}

function positiveIntegerPlainValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function finiteNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanBodyValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseOptionalPositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function recordBodyValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function stringArrayBodyValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return strings.length > 0 ? strings : undefined;
}

function stringRecordBodyValue(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
    .map(([key, field]) => [key, field.trim()] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function maybeConfirmPromptGroup(promptGroup: ImagePromptGroup, body: Record<string, unknown>): ImagePromptGroup {
  return body.confirm === false ? promptGroup : confirmImagePromptGroup(promptGroup);
}

function imageScheduleAspectRatioValue(value: string | undefined): ImageScheduleAspectRatio | undefined {
  return value === "9:16" || value === "16:9" || value === "1:1" ? value : undefined;
}

function qivanceAspectRatioValue(value: unknown): QivanceAspectRatio | undefined {
  return value === "9:16" || value === "16:9" || value === "1:1" ? value : undefined;
}

function renderManifestProjectMode(mode: WorkbenchProjectStatus["mode"]): RenderManifestV3ProjectMode {
  if (mode === "image_music_mode" || mode === "source_video_mode") return mode;
  throw new ApiRouteError(409, "unsupported_project_mode", "Render/export requires image_music_mode or source_video_mode.");
}

async function readPrimaryAspectRatio(paths: SmallProjectPaths): Promise<QivanceAspectRatio | undefined> {
  const raw = await readFirstProjectJson<Record<string, unknown>>(paths, ["animation_plan.json", "qivance/animation_plan.json"]);
  if (!raw) return undefined;
  return qivanceAspectRatioValue(raw.aspectRatio) ?? qivanceAspectRatioValue(raw.aspect_ratio);
}

function projectAudioRelativePath(_paths: SmallProjectPaths): string {
  return "audio/master/active_music_take.mp3";
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePath(value: string): string {
  return value.replaceAll(path.sep, "/");
}

class ApiRouteError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function toRouteError(error: unknown): ApiRouteError {
  if (error instanceof ApiRouteError) return error;
  return new ApiRouteError(500, "internal_error", error instanceof Error ? error.message : String(error));
}
