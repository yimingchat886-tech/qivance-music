import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadArtifactCatalog, type ArtifactGroup, type ArtifactItem } from "./artifact-catalog.ts";
import { loadGateProgress, type GateProgressStep } from "./gate-progress.ts";
import { buildHyperframesStudioUrl, loadHyperframesUiStatus, type HyperframesUiStatus } from "./hyperframes-ui.ts";
import { defaultMainComposition, videoSizes } from "./render-settings.ts";

export type StoryboardImportSummary =
  | { status: "pending" }
  | { status: "imported"; sceneCount: number; captionCount: number; visualCount: number };

export type ProjectSummary = {
  projectId: string;
  projectPath: string;
  topic: string;
  workflowState: string;
  targetDuration: number | null;
  actualAudioDuration: number | null;
  aspectRatio: string;
  mainComposition: string;
  videoSize: string;
  lockedAudioHash: string | null;
  previewVideoHash: string | null;
  hasPreview: boolean;
  gateProgress: GateProgressStep[];
  hyperframesUi: HyperframesUiStatus;
  storyboardImport: StoryboardImportSummary;
  artifactGroups: ArtifactGroup[];
  availableDownloads: Array<{ label: string; relativePath: string }>;
};

export async function listProjectSummaries(storageRoot: string): Promise<ProjectSummary[]> {
  try {
    const entries = await readdir(storageRoot, { withFileTypes: true });
    const summaries = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("project_"))
        .map((entry) => loadProjectSummary(path.join(storageRoot, entry.name))),
    );
    return summaries.sort((a, b) => b.projectId.localeCompare(a.projectId));
  } catch {
    return [];
  }
}

export async function loadProjectSummary(projectPath: string, requestHost?: string): Promise<ProjectSummary> {
  const manifest = await readJson<Record<string, unknown>>(path.join(projectPath, "project_manifest.json"));
  const projectId = String(manifest.project_id);
  const artifactGroups = await loadArtifactCatalog(projectPath, { includeHashes: false });
  const availableDownloads = artifactGroups.flatMap((group) =>
    group.artifacts
      .filter((artifact) => artifact.exists)
      .map((artifact) => ({ label: `${group.label}: ${artifact.label}`, relativePath: artifact.relativePath })),
  );

  const workflowState = String(manifest.current_workflow_state ?? "unknown");
  const hyperframesUi = await loadHyperframesUiStatus(projectPath);
  return {
    projectId,
    projectPath,
    topic: String(manifest.topic ?? projectId),
    workflowState,
    targetDuration: numberOrNull(manifest.target_duration),
    actualAudioDuration: numberOrNull(manifest.actual_audio_duration),
    aspectRatio: String(manifest.aspect_ratio ?? "9:16"),
    mainComposition: String(manifest.main_composition ?? defaultMainComposition),
    videoSize: String(manifest.video_size ?? "1080x1920"),
    lockedAudioHash: nullableString(manifest.locked_audio_hash),
    previewVideoHash: nullableString(manifest.preview_video_hash),
    hasPreview: await exists(path.join(projectPath, "dist", "preview", "preview_composite.mp4")),
    gateProgress: await loadGateProgress(projectPath),
    hyperframesUi: rewriteHyperframesUrl(hyperframesUi, requestHost),
    storyboardImport: await loadStoryboardImportSummary(projectPath, workflowState),
    artifactGroups,
    availableDownloads,
  };
}

export function renderProjectsPage(projects: ProjectSummary[]): string {
  const rows = projects.length === 0
    ? `<tr><td colspan="6">No imported projects yet.</td></tr>`
    : projects
        .map(
          (project) => `<tr>
  <td><a href="/projects/${encodeURIComponent(project.projectId)}">${escapeHtml(project.topic)}</a></td>
  <td><code>${escapeHtml(project.workflowState)}</code></td>
  <td>${project.hasPreview ? "Ready" : "Not yet"}</td>
  <td>${escapeHtml(project.aspectRatio)}</td>
  <td>${project.actualAudioDuration ?? "-"}</td>
  <td><form method="post" action="/projects/${encodeURIComponent(project.projectId)}/delete"><button type="submit">删除</button></form></td>
</tr>`,
        )
        .join("\n");

  return layout("Projects", `<section class="toolbar"><a class="button" href="/projects/new">导入已接受音乐项目</a></section>
<table>
  <thead><tr><th>Topic</th><th>Status</th><th>Preview</th><th>Aspect</th><th>Audio seconds</th><th>Actions</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`);
}

export function renderImportPage(error?: string): string {
  const videoSizeOptions = videoSizes
    .map((size) => `<option value="${size.id}">${size.id} (${size.aspectRatio})</option>`)
    .join("\n");
  return layout("Import accepted MiniMax music", `${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/projects/import" enctype="multipart/form-data" class="stack">
  <label>Audio file<input type="file" name="rawAudioFile" accept="audio/*" required></label>
  <label>Topic<input name="topic" value="恒星为什么会发光" required></label>
  <label>Target duration seconds<input type="number" name="targetDuration" min="1" step="1" value="60" required></label>
  <label>Main composition<input name="mainComposition" value="${defaultMainComposition}" required></label>
  <label>Video size<select name="videoSize" required>${videoSizeOptions}</select></label>
  <label>Lyrics markdown<textarea name="lyricsMarkdown" rows="10" required>[Verse]
恒星核心在聚变
光和热一起冲出来</textarea></label>
  <button type="submit">导入并进入音频锁定</button>
</form>`);
}

export function renderProjectWorkspace(project: ProjectSummary, options: { error?: string } = {}): string {
  const artifactGroups = renderArtifactGroups(project, project.artifactGroups);
  const action = project.workflowState === "music_accepted"
    ? `<form method="post" action="/projects/${encodeURIComponent(project.projectId)}/run-preview"><button type="submit">运行到分镜审批</button></form>`
    : project.workflowState === "music_locking" || project.workflowState === "music_locked"
      ? `<form method="post" action="/projects/${encodeURIComponent(project.projectId)}/run-preview"><button type="submit">运行到分镜审批</button></form>`
    : project.workflowState === "scene_waiting_human"
      ? `<form method="post" action="/projects/${encodeURIComponent(project.projectId)}/approve-scene"><button type="submit">开始制作 HyperFrames 视频</button></form>`
    : project.workflowState === "preview_waiting_human"
      ? `<form method="post" action="/projects/${encodeURIComponent(project.projectId)}/approve-preview"><button type="submit">OK，Preview 通过并登记成品</button></form>`
    : project.workflowState === "hypeframes_video_ready"
      ? `<p class="success">Preview workflow complete. Assets are ready to download.</p>`
      : `<p class="muted">当前状态下没有可执行的手动操作，请等待系统完成当前任务。</p>`;

  return layout(project.topic, `${options.error ? `<p class="error">${escapeHtml(options.error)}</p>` : ""}${renderGateProgress(project.gateProgress)}
<section class="grid">
  <article>
    <h2>Project</h2>
    <dl>
      <dt>ID</dt><dd><code>${escapeHtml(project.projectId)}</code></dd>
      <dt>Status</dt><dd><code>${escapeHtml(project.workflowState)}</code></dd>
      <dt>Execution</dt><dd>${escapeHtml(workflowStatusLabel(project.workflowState))}</dd>
      <dt>Aspect</dt><dd>${escapeHtml(project.aspectRatio)}</dd>
      <dt>Composition</dt><dd><code>${escapeHtml(project.mainComposition)}</code></dd>
      <dt>Video size</dt><dd>${escapeHtml(project.videoSize)}</dd>
      <dt>Target duration</dt><dd>${project.targetDuration ?? "-"}</dd>
      <dt>Actual audio duration</dt><dd>${project.actualAudioDuration ?? "-"}</dd>
      <dt>Locked audio hash</dt><dd><code>${escapeHtml(project.lockedAudioHash ?? "-")}</code></dd>
    </dl>
    ${action}
  </article>
  <article>
    <h2>Music</h2>
    <p>本版只展示导入的已接受音乐、歌词和音频 manifest，不提供 MiniMax 生成或重新生成入口。</p>
  </article>
  <article>
    <h2>Storyboard Import</h2>
    ${renderStoryboardImport(project)}
  </article>
  <article>
    <h2>HyperFrames UI</h2>
    ${renderHyperframesUi(project)}
  </article>
  <article>
    <h2>QA / Export</h2>
    ${artifactGroups}
  </article>
</section>`);
}

export function renderHyperframesPage(project: ProjectSummary, options: { error?: string } = {}): string {
  const projectId = encodeURIComponent(project.projectId);
  const url = project.hyperframesUi.url;
  const hypeframesGroup = project.artifactGroups.find((group) => group.id === "hypeframes_project");
  const codexGroup = project.artifactGroups.find((group) => group.id === "wsl_codex_agent");
  const renderGroup = project.artifactGroups.find((group) => group.id === "render_preview");
  const pageGroups = [hypeframesGroup, codexGroup].filter((group): group is ArtifactGroup => Boolean(group));
  const directUrl = url
    ? `<p>Direct URL: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`
    : "";
  const iframe = project.hyperframesUi.status === "running" && url
    ? `<iframe src="${escapeHtml(url)}" title="HyperFrames UI"></iframe>`
    : `<p class="muted">HyperFrames UI is not running.</p>`;
  const codexArtifacts = codexGroup?.artifacts ?? [];
  const hypeframesArtifacts = hypeframesGroup?.artifacts ?? [];
  const linkList = (artifacts: ArtifactItem[]) => artifacts
    .map((artifact) => `<li>${escapeHtml(artifact.label)} ${artifactPath(project, artifact.relativePath, artifact.exists)}${artifact.exists ? "" : ' <span class="muted">missing</span>'}</li>`)
    .join("\n");

  return layout(`HyperFrames · ${project.topic}`, `${options.error ? `<p class="error">${escapeHtml(options.error)}</p>` : ""}
<p><a href="/projects/${projectId}">Back to project workbench</a></p>
<section class="grid">
  <article>
    <h2>Runtime</h2>
    <p>Workflow: <code>${escapeHtml(project.workflowState)}</code></p>
    <p>Status: <code>${escapeHtml(project.hyperframesUi.status)}</code> · ${escapeHtml(hyperframesUiStatusLabel(project.hyperframesUi.status))}</p>
    ${renderHyperframesRuntimeIssue(project.hyperframesUi)}
    ${directUrl}
    <form method="post" action="/projects/${projectId}/hyperframes-ui/start"><button type="submit">启动 / 重启 HyperFrames UI</button></form>
  </article>
  <article>
    <h2>WSL Codex CLI</h2>
    <p>Status: <code>${escapeHtml(codexGroup?.status ?? "pending")}</code></p>
    <ul>${linkList(codexArtifacts.filter((artifact) => /detection|availability/i.test(artifact.label)))}</ul>
  </article>
  <article>
    <h2>HyperFrames Skills</h2>
    <p>Status: <code>${escapeHtml(hypeframesGroup?.status ?? "pending")}</code></p>
    <ul>${linkList(hypeframesArtifacts.filter((artifact) => /skill/i.test(artifact.label)))}</ul>
  </article>
  <article>
    <h2>Codex Run Logs</h2>
    <ul>${linkList(codexArtifacts.filter((artifact) => /Latest Codex|changed files|diffstat/i.test(artifact.label)))}</ul>
  </article>
  <article>
    <h2>Gate Status</h2>
    <p>Codex forbidden path gate: <code>${escapeHtml(codexGroup?.status ?? "pending")}</code></p>
    <p>HypeFrames File QA: <code>${escapeHtml(hypeframesGroup?.status ?? "pending")}</code></p>
    <p>Render QA: <code>${escapeHtml(renderGroup?.status ?? "pending")}</code></p>
  </article>
</section>
<section class="stack">
  <article>
    <h2>HyperFrames UI</h2>
    ${iframe}
  </article>
  <article>
    <h2>HypeFrames / Codex Artifacts</h2>
    ${renderArtifactGroups(project, pageGroups)}
  </article>
</section>`);
}

export function renderNotFound(): string {
  return layout("Not found", `<p class="error">Project or route not found.</p><p><a href="/projects">Back to projects</a></p>`);
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Qivance Music</title>
  <style>
    :root{color-scheme:dark;--bg:#0d1117;--panel:#161b22;--text:#f0f6fc;--muted:#8b949e;--border:#30363d;--accent:#2f81f7}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    header,main{max-width:1180px;margin:0 auto;padding:24px}header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border)}
    a{color:#79c0ff;text-decoration:none}.button,button{display:inline-flex;align-items:center;min-height:36px;border:1px solid var(--accent);border-radius:6px;background:var(--accent);color:white;padding:0 14px;font-weight:650;cursor:pointer}
    table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--border);border-radius:8px;overflow:hidden}th,td{padding:12px;border-bottom:1px solid var(--border);text-align:left}th{color:var(--muted)}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.stack{display:grid;gap:16px;max-width:820px}article{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:18px}
    label{display:grid;gap:8px;color:var(--muted)}input,textarea,select{width:100%;border:1px solid var(--border);border-radius:6px;background:#010409;color:var(--text);padding:10px;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}
    dl{display:grid;grid-template-columns:160px 1fr;gap:8px 12px}dt{color:var(--muted)}dd{margin:0;min-width:0;overflow-wrap:anywhere}.error{color:#ff7b72}.success{color:#7ee787}
    .progress{margin-bottom:16px;background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:18px}.progress ol{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;list-style:none;margin:0;padding:0}.progress li{border:1px solid var(--border);border-radius:6px;padding:10px;min-width:0}.status-pass{border-color:#238636!important}.status-warning{border-color:#d29922!important}.status-fail{border-color:#da3633!important}.status-running{border-color:var(--accent)!important}.status-pending{color:var(--muted)}.artifact-group{border:1px solid var(--border);border-radius:6px;padding:12px;margin-top:12px}.artifact-group ul{margin:10px 0 0;padding-left:18px}.muted{color:var(--muted)}iframe{width:100%;min-height:520px;border:1px solid var(--border);border-radius:6px;background:#010409}
    @media(max-width:800px){header,main{padding:16px}.grid{grid-template-columns:1fr}dl{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <header><h1>${escapeHtml(title)}</h1><nav><a href="/projects">Projects</a></nav></header>
  <main>${body}</main>
</body>
</html>`;
}

function renderGateProgress(progress: GateProgressStep[]): string {
  const steps = progress
    .map((step) => `<li class="status-${step.status}">
  <strong>${escapeHtml(step.label)}</strong><br>
  <code>${escapeHtml(step.status)}</code>
  <p class="muted">Artifacts: ${step.availableArtifactCount} / ${step.artifactCount}</p>
  ${step.qaPath ? `<p class="muted">QA: <code>${escapeHtml(step.qaPath)}</code></p>` : ""}
  ${step.issues.length > 0 ? `<p class="error">${escapeHtml(step.issues.join(" "))}</p>` : ""}
  ${step.warnings.length > 0 ? `<p>${escapeHtml(step.warnings.join(" "))}</p>` : ""}
</li>`)
    .join("\n");
  return `<section class="progress"><h2>Gate Progress</h2><ol>${steps}</ol></section>`;
}

function renderArtifactGroups(project: ProjectSummary, groups: ArtifactGroup[]): string {
  if (groups.length === 0) {
    return `<p class="muted">No artifact groups yet.</p>`;
  }
  return groups
    .map((group) => {
      const availableCount = group.artifacts.filter((artifact) => artifact.exists).length;
      const qaLink = group.qaPath
        ? `<p class="muted">QA: ${artifactPath(project, group.qaPath, group.artifacts.some((artifact) => artifact.relativePath === group.qaPath && artifact.exists))}</p>`
        : "";
      const artifacts = group.artifacts.map((artifact) => renderArtifactItem(project, artifact)).join("\n");
      return `<section class="artifact-group">
  <h3>${escapeHtml(group.label)}</h3>
  <p>${escapeHtml(group.description)}</p>
  <p class="muted">Status: <code>${escapeHtml(group.status)}</code> · Artifacts: ${availableCount} / ${group.artifacts.length}</p>
  ${qaLink}
  <ul>${artifacts}</ul>
</section>`;
    })
    .join("\n");
}

function renderArtifactItem(project: ProjectSummary, artifact: ArtifactItem): string {
  const status = artifact.exists ? "" : ` <span class="muted">missing</span>`;
  return `<li>${escapeHtml(artifact.label)} ${artifactPath(project, artifact.relativePath, artifact.exists)}${status}</li>`;
}

function artifactPath(project: ProjectSummary, relativePath: string, exists: boolean): string {
  const pathLabel = `<code>${escapeHtml(relativePath)}</code>`;
  if (!exists) {
    return pathLabel;
  }
  return `<a href="/projects/${encodeURIComponent(project.projectId)}/download?path=${encodeURIComponent(relativePath)}">${pathLabel}</a>`;
}

function renderStoryboardImport(project: ProjectSummary): string {
  if (project.storyboardImport.status === "imported") {
    return `<section class="artifact-group">
  <p class="success">分镜脚本已导入。</p>
  <p class="muted">场景 ${project.storyboardImport.sceneCount} · 字幕 ${project.storyboardImport.captionCount} · 视觉 ${project.storyboardImport.visualCount}</p>
  <p>下一步：点击“开始制作 HyperFrames 视频”。</p>
</section>`;
  }

  return `<form method="post" action="/projects/${encodeURIComponent(project.projectId)}/storyboard/import" class="stack">
  <label>Storyboard JSON<textarea name="storyboardJson" rows="10" placeholder='{"scenes":[],"captions":[],"visuals":[]}' required></textarea></label>
  <button type="submit">导入外部 LLM 分镜脚本</button>
</form>`;
}

function renderHyperframesUi(project: ProjectSummary): string {
  const projectId = encodeURIComponent(project.projectId);
  const startForm = `<form method="post" action="/projects/${projectId}/hyperframes-ui/start"><button type="submit">启动 HyperFrames UI</button></form>`;
  const status = `<p>Runtime status: <code>${escapeHtml(project.hyperframesUi.status)}</code> · ${escapeHtml(hyperframesUiStatusLabel(project.hyperframesUi.status))}</p>`;
  const issue = renderHyperframesRuntimeIssue(project.hyperframesUi);
  const directUrl = project.hyperframesUi.status === "not_started"
    ? ""
    : `<p>Direct URL: <a href="${escapeHtml(project.hyperframesUi.url)}">${escapeHtml(project.hyperframesUi.url)}</a></p>`;
  const subpageLink = `<p><a class="button" href="/projects/${projectId}/hyperframes">打开 HyperFrames 子页面</a></p>`;
  return `${startForm}${status}${issue}${directUrl}${subpageLink}`;
}

async function loadStoryboardImportSummary(projectPath: string, workflowState: string): Promise<StoryboardImportSummary> {
  if (workflowState !== "scene_waiting_human") {
    return { status: "pending" };
  }
  const sceneCount = await storyboardArrayCount(projectPath, "data/storyboard/scene_plan.json", "scenes");
  if (sceneCount === null) {
    return { status: "pending" };
  }
  return {
    status: "imported",
    sceneCount,
    captionCount: await storyboardArrayCount(projectPath, "data/storyboard/caption_plan.json", "captions") ?? 0,
    visualCount: await storyboardArrayCount(projectPath, "data/storyboard/visual_plan.json", "visuals") ?? 0,
  };
}

async function storyboardArrayCount(projectPath: string, relativePath: string, key: string): Promise<number | null> {
  const value = await readOptionalJson<Record<string, unknown>>(path.join(projectPath, relativePath));
  const items = value?.[key];
  return Array.isArray(items) ? items.length : null;
}

function hyperframesUiStatusLabel(status: HyperframesUiStatus["status"]): string {
  switch (status) {
    case "not_started": return "等待启动";
    case "starting": return "正在启动 HyperFrames";
    case "retrying": return "HyperFrames 启动失败，正在重试";
    case "running": return "HyperFrames 已启动";
    case "stopped": return "已中断或已停止";
    case "failed": return "执行失败";
  }
}

function renderHyperframesRuntimeIssue(status: HyperframesUiStatus): string {
  if (status.status === "failed" && status.last_error) {
    return `<p class="error">${escapeHtml(status.last_error)}</p>`;
  }
  if (status.status === "retrying" && status.last_error) {
    return `<p class="muted">上次启动失败：${escapeHtml(status.last_error)}</p>`;
  }
  return "";
}

function workflowStatusLabel(state: string): string {
  if (state === "hypeframes_video_ready") return "渲染完成";
  if (state === "failed" || state.endsWith("_failed")) return "执行失败";
  if (state === "preview_rendering" || state === "render_file_qa_checking") return "正在渲染";
  if (state === "hypeframes_generating" || state === "hypeframes_project_ready" || state === "hypeframes_file_qa_checking") return "正在执行生成任务";
  if (state === "scene_waiting_human") return "等待人工分镜审批";
  if (state === "preview_waiting_human") return "等待人工审片";
  if (state === "music_accepted" || state === "timing_passed") return "等待启动";
  return "正在处理或等待系统继续";
}

function rewriteHyperframesUrl(status: HyperframesUiStatus, requestHost?: string): HyperframesUiStatus {
  if (!requestHost || status.status === "not_started") {
    return status;
  }
  return {
    ...status,
    url: buildHyperframesStudioUrl({ requestHost, port: status.port, projectName: "hypeframes" }),
  };
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function readOptionalJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
