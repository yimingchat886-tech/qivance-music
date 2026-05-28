import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type ProjectSummary = {
  projectId: string;
  projectPath: string;
  topic: string;
  workflowState: string;
  targetDuration: number | null;
  actualAudioDuration: number | null;
  aspectRatio: string;
  lockedAudioHash: string | null;
  previewVideoHash: string | null;
  hasPreview: boolean;
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

export async function loadProjectSummary(projectPath: string): Promise<ProjectSummary> {
  const manifest = await readJson<Record<string, unknown>>(path.join(projectPath, "project_manifest.json"));
  const projectId = String(manifest.project_id);
  const downloads = [
    ["Final", "dist/final/hypeframes_final.mp4"],
    ["Preview", "dist/preview/preview_composite.mp4"],
    ["Review", "dist/review/preview_composite_review.mp4"],
    ["Master audio", "audio/master/minimax_rap_master.wav"],
    ["Lyrics", "data/lyrics/lyrics.md"],
    ["Render manifest", "dist/render_manifest.json"],
    ["Master QA", "qa/master_qa_report.json"],
  ] as const;
  const availableDownloads = [];
  for (const [label, relativePath] of downloads) {
    if (await exists(path.join(projectPath, relativePath))) {
      availableDownloads.push({ label, relativePath });
    }
  }

  return {
    projectId,
    projectPath,
    topic: String(manifest.topic ?? projectId),
    workflowState: String(manifest.current_workflow_state ?? "unknown"),
    targetDuration: numberOrNull(manifest.target_duration),
    actualAudioDuration: numberOrNull(manifest.actual_audio_duration),
    aspectRatio: String(manifest.aspect_ratio ?? "9:16"),
    lockedAudioHash: nullableString(manifest.locked_audio_hash),
    previewVideoHash: nullableString(manifest.preview_video_hash),
    hasPreview: await exists(path.join(projectPath, "dist", "preview", "preview_composite.mp4")),
    availableDownloads,
  };
}

export function renderProjectsPage(projects: ProjectSummary[]): string {
  const rows = projects.length === 0
    ? `<tr><td colspan="5">No imported projects yet.</td></tr>`
    : projects
        .map(
          (project) => `<tr>
  <td><a href="/projects/${encodeURIComponent(project.projectId)}">${escapeHtml(project.topic)}</a></td>
  <td><code>${escapeHtml(project.workflowState)}</code></td>
  <td>${project.hasPreview ? "Ready" : "Not yet"}</td>
  <td>${escapeHtml(project.aspectRatio)}</td>
  <td>${project.actualAudioDuration ?? "-"}</td>
</tr>`,
        )
        .join("\n");

  return layout("Projects", `<section class="toolbar"><a class="button" href="/projects/new">导入已接受音乐项目</a></section>
<table>
  <thead><tr><th>Topic</th><th>Status</th><th>Preview</th><th>Aspect</th><th>Audio seconds</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`);
}

export function renderImportPage(error?: string): string {
  return layout("Import accepted MiniMax music", `${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/projects/import" class="stack">
  <label>Raw audio path on this machine<input name="rawAudioPath" placeholder="/absolute/path/minimax_rap_raw.mp3" required></label>
  <label>Input config JSON<textarea name="inputConfig" rows="12" required>{
  "topic": "恒星为什么会发光",
  "target_duration": 60,
  "audience": "泛科普用户",
  "tone": "热血",
  "rap_style": "boom bap",
  "aspect_ratio": "9:16",
  "platform": "douyin",
  "auto_continue": false,
  "auto_approve_music": true,
  "auto_approve_preview": false
}</textarea></label>
  <label>Lyrics markdown<textarea name="lyricsMarkdown" rows="10" required>[Verse]
恒星核心在聚变
光和热一起冲出来</textarea></label>
  <button type="submit">导入并置为 music_accepted</button>
</form>`);
}

export function renderProjectWorkspace(project: ProjectSummary): string {
  const downloads = project.availableDownloads.length === 0
    ? "<li>No downloads yet.</li>"
    : project.availableDownloads
        .map(
          (asset) => `<li><a href="/projects/${encodeURIComponent(project.projectId)}/download?path=${encodeURIComponent(asset.relativePath)}">${escapeHtml(asset.label)}</a> <code>${escapeHtml(asset.relativePath)}</code></li>`,
        )
        .join("\n");
  const action = project.workflowState === "music_accepted"
    ? `<form method="post" action="/projects/${encodeURIComponent(project.projectId)}/run-preview"><button type="submit">运行到分镜审批</button></form>`
    : project.workflowState === "music_locking" || project.workflowState === "music_locked"
      ? `<form method="post" action="/projects/${encodeURIComponent(project.projectId)}/run-preview"><button type="submit">运行到分镜审批</button></form>`
    : project.workflowState === "scene_waiting_human"
      ? `<form method="post" action="/projects/${encodeURIComponent(project.projectId)}/approve-scene"><button type="submit">OK，分镜通过并渲染 Preview</button></form>`
    : project.workflowState === "preview_waiting_human"
      ? `<form method="post" action="/projects/${encodeURIComponent(project.projectId)}/approve-preview"><button type="submit">OK，Preview 通过并登记成品</button></form>`
    : project.workflowState === "hypeframes_video_ready"
      ? `<p class="success">Preview workflow complete. Assets are ready to download.</p>`
      : `<p>Current status does not expose a manual action in this first MVP.</p>`;

  return layout(project.topic, `<section class="grid">
  <article>
    <h2>Project</h2>
    <dl>
      <dt>ID</dt><dd><code>${escapeHtml(project.projectId)}</code></dd>
      <dt>Status</dt><dd><code>${escapeHtml(project.workflowState)}</code></dd>
      <dt>Aspect</dt><dd>${escapeHtml(project.aspectRatio)}</dd>
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
    <h2>Video</h2>
    ${project.hasPreview ? `<video controls src="/projects/${encodeURIComponent(project.projectId)}/download?path=dist%2Fpreview%2Fpreview_composite.mp4"></video>` : "<p>Preview not rendered yet.</p>"}
  </article>
  <article>
    <h2>QA / Export</h2>
    <ul>${downloads}</ul>
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
    label{display:grid;gap:8px;color:var(--muted)}input,textarea{width:100%;border:1px solid var(--border);border-radius:6px;background:#010409;color:var(--text);padding:10px;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}
    dl{display:grid;grid-template-columns:160px 1fr;gap:8px 12px}dt{color:var(--muted)}dd{margin:0;min-width:0;overflow-wrap:anywhere}video{width:100%;max-height:560px;background:#010409}.error{color:#ff7b72}.success{color:#7ee787}
    @media(max-width:800px){header,main{padding:16px}.grid{grid-template-columns:1fr}dl{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <header><h1>${escapeHtml(title)}</h1><nav><a href="/projects">Projects</a></nav></header>
  <main>${body}</main>
</body>
</html>`;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
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
