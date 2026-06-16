import type { V3ProjectListItem } from "./api-types.ts";
import type { SchedulerStatusSummary } from "../scheduler/scheduler-status.ts";
import type { WorkbenchAgentRunSummary, WorkbenchArtifact, WorkbenchFileRef, WorkbenchProjectStatus, WorkbenchStep } from "./project-status.ts";

export type WorkbenchChainSummary = {
  chain_id: string;
  status: string;
  mode?: string;
  blocking_reasons?: unknown[];
  artifacts?: Record<string, WorkbenchFileRef>;
  metrics?: Record<string, string | number | boolean>;
};

export type V5WorkbenchProjectDetail = {
  schema_version: number;
  project_id: string;
  title: string;
  description?: string | null;
  content_type: string;
  status: string;
  project_root: string;
  inputs: Array<{
    id: string;
    kind: string;
    status: string;
    original_name: string;
    path: string;
    stable_path: string;
    sha256: string;
    mime: string;
    created_at: string;
  }>;
  chains: Array<{
    id: string;
    chain_id: string;
    status: string;
    metrics_json?: string | null;
    last_error?: string | null;
    updated_at: string;
  }>;
  artifacts: Array<{
    id: string;
    chain_id?: string | null;
    kind: string;
    path: string;
    sha256: string;
    schema_version?: string | null;
    status: string;
    created_by_run_id?: string | null;
    created_at: string;
  }>;
  runs: Array<{
    id: string;
    status: string;
    mode: string;
    priority: number;
    stop_requested: boolean;
    created_at: string;
    updated_at: string;
    tasks: Array<{
      id: string;
      chain_id: string;
      stage: string;
      status: string;
      last_error?: string | null;
      started_at?: string | null;
      finished_at?: string | null;
    }>;
    events: Array<{
      id: string;
      task_id?: string | null;
      event_type: string;
      message: string;
      details_json?: string | null;
      created_at: string;
    }>;
  }>;
};

export function renderWorkbenchProjectsPage(input: { projects: V3ProjectListItem[] }): string {
  const rows = input.projects.length === 0
    ? `<tr><td colspan="8">No projects found.</td></tr>`
    : input.projects.map((project) => `
      <tr>
        <td><a href="/projects/${encodeURIComponent(project.small_project_id)}">${escapeHtml(project.small_project_id)}</a></td>
        <td>${escapeHtml(project.title ?? "")}</td>
        <td>${escapeHtml(project.content_type ?? "")}</td>
        <td>${badge(project.source ?? "file_system")}</td>
        <td>${badge(project.mode)}</td>
        <td>${badge(project.status)}</td>
        <td><code>${escapeHtml(project.project_root)}</code></td>
        <td><a class="button" href="/projects/${encodeURIComponent(project.small_project_id)}">Open</a></td>
      </tr>
    `).join("");
  return layout("Qivance Workbench", `
    <header class="page-header">
      <h1>Qivance Workbench</h1>
      <p>Production project status and V3 actions.</p>
    </header>
    <section>
      <h2>Projects</h2>
      <form data-action="create-v5-project" class="toolbar">
        <label>Title <input name="title" required></label>
        <label>Content type <select name="content_type"><option value="chat_dialogue_mv">chat_dialogue_mv</option></select></label>
        <label>Description <input name="description"></label>
        <button type="submit">Create V5 Project</button>
      </form>
      <pre id="project-action-result" aria-live="polite"></pre>
      <table>
        <thead><tr><th>Project</th><th>Title</th><th>Content</th><th>Source</th><th>Mode</th><th>Status</th><th>Root</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
    ${projectsClientScript()}
  `);
}

export function renderWorkbenchProjectDetailPage(input: {
  status: WorkbenchProjectStatus;
  schedulerStatus?: SchedulerStatusSummary;
  chains?: WorkbenchChainSummary[];
}): string {
  const status = input.status;
  return layout(`${status.small_project_id} - Qivance Workbench`, `
    <header class="page-header">
      <a href="/projects">Projects</a>
      <h1>${escapeHtml(status.small_project_id)}</h1>
      <div class="meta">
        ${badge(status.mode)}
        ${badge(status.overall_status)}
        ${badge(status.primary_ratio ?? "ratio unknown")}
      </div>
    </header>
    ${blockingReasons(status.blocking_reasons)}
    <div class="grid">
      ${section("Input Diagnostics", fileList([
        ["Music take", status.inputs.active_music_take],
        ["Lyrics", status.inputs.lyrics],
        ["Animation Plan", status.inputs.animation_plan],
        ["Image Generation Plan", status.inputs.image_generation_plan],
        ["Source Video", status.inputs.source_video],
      ]))}
      ${section("Workflow Steps", stepList(status.steps))}
      ${section("Animation Plan Approval", approvalBlock(status))}
      ${section("Image Schedule", artifactBlock(status, "image_generation_schedule"))}
      ${section("Image Prompt Group", artifactBlock(status, "image_prompt_group"))}
      ${section("Image Review", artifactBlock(status, "image_review_decisions") + artifactBlock(status, "image_assets"))}
      ${section("Source MP4", sourceVideoBlock(status))}
      ${section("Preview", previewBlock(status))}
      ${input.schedulerStatus ? section("Scheduler", schedulerBlock(input.schedulerStatus)) : ""}
      ${input.chains && input.chains.length > 0 ? section("Chains", chainList(input.chains)) : ""}
      ${section("Revision", revisionForm(status))}
      ${section("Agent Runs", agentRunList(status.agent_runs))}
      ${section("Export", exportBlock(status))}
    </div>
    ${clientScript(status.small_project_id)}
  `);
}

export function renderWorkbenchV5ProjectDetailPage(input: { detail: V5WorkbenchProjectDetail }): string {
  const detail = input.detail;
  return layout(`${detail.title} - Qivance V5 Workbench`, `
    <header class="page-header">
      <a href="/projects">Projects</a>
      <h1>${escapeHtml(detail.title)}</h1>
      <div class="meta">
        ${badge("v5_control_plane")}
        ${badge(detail.content_type)}
        ${badge(detail.status)}
      </div>
      <p><code>${escapeHtml(detail.project_id)}</code> <code>${escapeHtml(detail.project_root)}</code></p>
    </header>
    <div class="grid">
      ${section("V5 Inputs", v5InputsBlock(detail))}
      ${section("Run Control", v5RunControlBlock(detail))}
      ${section("Artifacts", v5ArtifactsBlock(detail))}
      ${section("Task Events", v5EventsBlock(detail))}
    </div>
    ${v5ClientScript(detail.project_id)}
  `);
}

function v5InputsBlock(detail: V5WorkbenchProjectDetail): string {
  const inputRows = detail.inputs.length === 0
    ? `<tr><td colspan="6">No inputs.</td></tr>`
    : detail.inputs.map((input) => `
      <tr>
        <td>${badge(input.kind)}</td>
        <td>${badge(input.status)}</td>
        <td>${escapeHtml(input.original_name)}</td>
        <td><code>${escapeHtml(input.path)}</code></td>
        <td><code>${escapeHtml(input.stable_path)}</code></td>
        <td><small>${escapeHtml(input.sha256.slice(0, 12))}</small></td>
      </tr>
    `).join("");
  const canConfirm = hasActiveV5Input(detail, "lyrics") && hasActiveV5Input(detail, "audio") && !hasActiveV5Run(detail);
  return `
    <table>
      <thead><tr><th>Kind</th><th>Status</th><th>Name</th><th>Path</th><th>Stable</th><th>SHA</th></tr></thead>
      <tbody>${inputRows}</tbody>
    </table>
    <form data-action="v5-input-upload">
      <label>Lyrics text <textarea name="lyrics_text" rows="5"></textarea></label>
      <label>Lyrics file <input type="file" name="lyrics_file" accept=".md,.txt,text/markdown,text/plain"></label>
      <label>Audio file <input type="file" name="audio_file" accept=".mp3,.wav,audio/mpeg,audio/wav"></label>
      <label class="inline"><input type="checkbox" name="replace" value="true"> Replace active inputs</label>
      <button type="submit">Upload Inputs</button>
    </form>
    <p><button data-action="v5-confirm-inputs" ${canConfirm ? "" : "disabled"}>Confirm Inputs</button></p>
    <pre id="action-result" aria-live="polite"></pre>
  `;
}

function v5RunControlBlock(detail: V5WorkbenchProjectDetail): string {
  if (detail.runs.length === 0) return `<p>No scheduler runs.</p>`;
  return detail.runs.map((run) => {
    const canStop = !["passed", "failed", "blocked", "stopped"].includes(run.status);
    return `
      <article class="run-block">
        <header>
          <h3>${escapeHtml(run.id)}</h3>
          ${badge(run.status)}
          ${badge(run.mode)}
          <button data-action="v5-stop-run" data-run-id="${escapeHtml(run.id)}" ${canStop ? "" : "disabled"}>Stop Run</button>
        </header>
        <table>
          <thead><tr><th>Stage</th><th>Status</th><th>Error</th></tr></thead>
          <tbody>${run.tasks.map((task) => `
            <tr>
              <td><code>${escapeHtml(task.stage)}</code></td>
              <td>${badge(task.status)}</td>
              <td>${task.last_error ? escapeHtml(task.last_error) : ""}</td>
            </tr>
          `).join("")}</tbody>
        </table>
      </article>
    `;
  }).join("");
}

function v5ArtifactsBlock(detail: V5WorkbenchProjectDetail): string {
  const rows = [
    ["final_mp4", "exports/chat_dialogue_mv/final.mp4"],
    ["visual_mp4", "exports/chat_dialogue_mv/visual.mp4"],
    ["render_manifest", "exports/chat_dialogue_mv/render_manifest.json"],
    ["qa_report", "data/chains/chat_dialogue_mv/qa_report.json"],
  ].map(([label, artifactPath]) => {
    const artifact = detail.artifacts.find((item) => item.path === artifactPath);
    return `
      <tr>
        <td><code>${escapeHtml(label)}</code></td>
        <td>${artifact ? badge(artifact.status) : `<span class="missing">missing</span>`}</td>
        <td>${artifact ? v5ArtifactLink(detail.project_id, artifact.path) : `<code>${escapeHtml(artifactPath)}</code>`}</td>
        <td>${artifact ? `<small>${escapeHtml(artifact.sha256.slice(0, 12))}</small>` : ""}</td>
      </tr>
    `;
  }).join("");
  return `<table><thead><tr><th>Artifact</th><th>Status</th><th>Path</th><th>SHA</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function v5EventsBlock(detail: V5WorkbenchProjectDetail): string {
  const events = detail.runs.flatMap((run) => run.events.map((event) => ({ ...event, run_id: run.id })))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 20);
  if (events.length === 0) return `<p>No events.</p>`;
  return `<table><thead><tr><th>Run</th><th>Event</th><th>Message</th><th>At</th></tr></thead><tbody>${events.map((event) => `
    <tr>
      <td><code>${escapeHtml(event.run_id)}</code></td>
      <td>${badge(event.event_type)}</td>
      <td>${escapeHtml(event.message)}</td>
      <td><small>${escapeHtml(event.created_at)}</small></td>
    </tr>
  `).join("")}</tbody></table>`;
}

function hasActiveV5Input(detail: V5WorkbenchProjectDetail, kind: string): boolean {
  return detail.inputs.some((input) => input.kind === kind && input.status === "active");
}

function hasActiveV5Run(detail: V5WorkbenchProjectDetail): boolean {
  return detail.runs.some((run) => ["queued", "running", "stopping"].includes(run.status));
}

function v5ArtifactLink(projectId: string, artifactPath: string): string {
  if (artifactPath === "exports/chat_dialogue_mv/final.mp4") {
    return `<a href="/api/projects/${encodeURIComponent(projectId)}/chains/chat-dialogue-mv/export/final.mp4">final.mp4</a>`;
  }
  return `<a href="/projects/${encodeURIComponent(projectId)}/download?path=${encodeURIComponent(artifactPath)}">${escapeHtml(artifactPath)}</a>`;
}

function blockingReasons(reasons: WorkbenchProjectStatus["blocking_reasons"]): string {
  if (reasons.length === 0) return `<section class="notice passed">No blocking reasons.</section>`;
  return `<section class="notice blocked"><h2>Blocking Reasons</h2><ul>${reasons.map((reason) =>
    `<li><strong>${escapeHtml(reason.code)}</strong>: ${escapeHtml(reason.message)}</li>`
  ).join("")}</ul></section>`;
}

function section(title: string, body: string): string {
  return `<section class="panel"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function fileList(items: Array<[string, WorkbenchFileRef]>): string {
  return `<dl>${items.map(([label, ref]) => `
    <dt>${escapeHtml(label)}</dt>
    <dd>${fileRef(ref)}</dd>
  `).join("")}</dl>`;
}

function stepList(steps: WorkbenchStep[]): string {
  return `<ol class="steps">${steps.map((step) => `
    <li>
      <span>${escapeHtml(step.label)}</span>
      ${badge(step.status)}
      <small>${step.artifacts.map((artifact) => escapeHtml(artifact.id)).join(", ")}</small>
    </li>
  `).join("")}</ol>`;
}

function approvalBlock(status: WorkbenchProjectStatus): string {
  const approved = status.inputs.animation_plan.approved;
  return `
    <p>${approved ? "Animation Plan approved." : "Animation Plan approval is required before production actions."}</p>
    <button data-action="approve-animation" ${approved || !status.inputs.animation_plan.exists ? "disabled" : ""}>Approve Animation Plan</button>
    <pre id="action-result" aria-live="polite"></pre>
  `;
}

function artifactBlock(status: WorkbenchProjectStatus, id: string): string {
  const artifact = status.artifacts.find((candidate) => candidate.id === id);
  if (!artifact) return `<p>${escapeHtml(id)} not registered.</p>`;
  return `<p>${escapeHtml(id)}: ${fileRef(artifact)}</p>`;
}

function sourceVideoBlock(status: WorkbenchProjectStatus): string {
  return `
    <p>${fileRef(status.inputs.source_video)}</p>
    <form data-action="source-video-import">
      <label>Source MP4 path <input name="source_path" value="source_video.mp4"></label>
      <button type="submit">Import Source MP4</button>
    </form>
  `;
}

function previewBlock(status: WorkbenchProjectStatus): string {
  const previewReady = status.steps.some((step) => step.id === "preview" && (step.status === "ready" || step.status === "passed"));
  return previewReady
    ? `<iframe title="Preview" src="/api/projects/${encodeURIComponent(status.small_project_id)}/html-video/preview"></iframe>`
    : `<p>Preview is not ready.</p>`;
}

function schedulerBlock(status: SchedulerStatusSummary): string {
  return `
    <dl>
      <dt>Status</dt><dd>${badge(status.overall_status)}</dd>
      <dt>Ready tasks</dt><dd>${status.ready_task_count}</dd>
      <dt>Running tasks</dt><dd>${status.running_task_count}</dd>
      <dt>Blocked tasks</dt><dd>${status.blocked_task_count}</dd>
      <dt>Active projects</dt><dd>${inlineCodeList(status.active_projects)}</dd>
      <dt>Active chains</dt><dd>${inlineCodeList(status.active_chains)}</dd>
    </dl>
    ${status.resource_locks.length === 0
      ? `<p>No resource locks.</p>`
      : `<table><thead><tr><th>Resource</th><th>Project</th><th>Chain</th><th>Task</th></tr></thead><tbody>${status.resource_locks.map((lock) => `
        <tr>
          <td>${badge(lock.resource)}</td>
          <td><code>${escapeHtml(lock.project_id)}</code></td>
          <td><code>${escapeHtml(lock.chain_id)}</code></td>
          <td><code>${escapeHtml(lock.owner_task_id)}</code></td>
        </tr>
      `).join("")}</tbody></table>`}
  `;
}

function chainList(chains: WorkbenchChainSummary[]): string {
  return `<table><thead><tr><th>Chain</th><th>Status</th><th>Mode</th><th>Blocking</th><th>Metrics</th><th>Artifacts</th></tr></thead><tbody>${chains.map((chain) => `
    <tr>
      <td><code>${escapeHtml(chain.chain_id)}</code></td>
      <td>${badge(chain.status)}</td>
      <td>${badge(chain.mode ?? "unknown")}</td>
      <td>${blockingCount(chain.blocking_reasons)}</td>
      <td>${chainMetrics(chain.metrics)}</td>
      <td>${chainArtifacts(chain.artifacts)}</td>
    </tr>
  `).join("")}</tbody></table>`;
}

function inlineCodeList(items: string[]): string {
  if (items.length === 0) return `<span class="missing">none</span>`;
  return items.map((item) => `<code>${escapeHtml(item)}</code>`).join(" ");
}

function blockingCount(reasons: unknown[] | undefined): string {
  if (!reasons || reasons.length === 0) return `<span class="exists">0</span>`;
  return `<span class="missing">${reasons.length}</span>`;
}

function chainMetrics(metrics: Record<string, string | number | boolean> | undefined): string {
  if (!metrics || Object.keys(metrics).length === 0) return `<span class="missing">missing</span>`;
  return Object.entries(metrics).map(([id, value]) => `
    <div><code>${escapeHtml(id)}</code> ${escapeHtml(String(value))}</div>
  `).join("");
}

function chainArtifacts(artifacts: Record<string, WorkbenchFileRef> | undefined): string {
  if (!artifacts) return `<span class="missing">missing</span>`;
  return Object.entries(artifacts).map(([id, ref]) => `
    <div><code>${escapeHtml(id)}</code> ${ref.exists ? `<span class="exists">exists</span>` : `<span class="missing">missing</span>`}</div>
  `).join("");
}

function revisionForm(status: WorkbenchProjectStatus): string {
  return `
    <form data-action="revise">
      <label>Scope
        <select name="scope_type">
          <option value="project">Project</option>
          <option value="scene">Scene</option>
        </select>
      </label>
      <label>Scene ID <input name="scene_id" placeholder="scene_001_hook"></label>
      <label>Request <textarea name="request" rows="4"></textarea></label>
      <button type="submit">Submit Revision</button>
    </form>
    <p>Current revision: ${fileRef(status.artifacts.find((artifact) => artifact.id === "revision_request"))}</p>
  `;
}

function agentRunList(agentRuns: WorkbenchAgentRunSummary[]): string {
  if (agentRuns.length === 0) return `<p>No agent runs recorded.</p>`;
  return `<table><thead><tr><th>Run</th><th>Mode</th><th>Status</th><th>Exit</th></tr></thead><tbody>${agentRuns.map((run) => `
    <tr>
      <td>${fileRef(run)}</td>
      <td>${badge(run.mode ?? "unknown")}</td>
      <td>${badge(run.status ?? "not_started")}</td>
      <td>${run.exit_code ?? ""}${run.timed_out ? " timed out" : ""}</td>
    </tr>
  `).join("")}</tbody></table>`;
}

function exportBlock(status: WorkbenchProjectStatus): string {
  const finalMp4 = status.export.final_mp4.exists
    ? `<a class="button" href="/api/projects/${encodeURIComponent(status.small_project_id)}/export/final.mp4">Download final MP4</a>`
    : `<button disabled>Download final MP4</button>`;
  return `${artifactBlock(status, "render_manifest")}<p>${finalMp4}</p>`;
}

function fileRef(ref: WorkbenchFileRef | WorkbenchArtifact | undefined): string {
  if (!ref) return `<span class="missing">missing</span>`;
  if (!ref.exists) return `<span class="missing">missing</span> <code>${escapeHtml(ref.path ?? "")}</code>`;
  return `<span class="exists">exists</span> <code>${escapeHtml(ref.path ?? "")}</code>${ref.sha256 ? ` <small>${escapeHtml(ref.sha256.slice(0, 12))}</small>` : ""}`;
}

function badge(value: string): string {
  return `<span class="badge ${cssToken(value)}">${escapeHtml(value)}</span>`;
}

function projectsClientScript(): string {
  return `<script>
    const projectResult = document.getElementById("project-action-result");
    document.querySelector("[data-action='create-v5-project']")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (projectResult) projectResult.textContent = "Running...";
      const data = new FormData(event.currentTarget);
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: data.get("title"),
          content_type: data.get("content_type"),
          description: data.get("description"),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (projectResult) projectResult.textContent = JSON.stringify(json, null, 2);
        return;
      }
      location.href = "/projects/" + encodeURIComponent(json.project_id);
    });
  </script>`;
}

function v5ClientScript(projectId: string): string {
  return `<script>
    const projectId = ${JSON.stringify(projectId)};
    const result = document.getElementById("action-result");
    async function showResponse(response) {
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (result) result.textContent = JSON.stringify(json, null, 2);
        return;
      }
      location.reload();
    }
    document.querySelector("[data-action='v5-input-upload']")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (result) result.textContent = "Running...";
      await showResponse(await fetch("/api/projects/" + encodeURIComponent(projectId) + "/inputs", {
        method: "POST",
        body: new FormData(event.currentTarget),
      }));
    });
    document.querySelector("[data-action='v5-confirm-inputs']")?.addEventListener("click", async () => {
      if (result) result.textContent = "Running...";
      await showResponse(await fetch("/api/projects/" + encodeURIComponent(projectId) + "/inputs/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }));
    });
    document.querySelectorAll("[data-action='v5-stop-run']").forEach((button) => {
      button.addEventListener("click", async () => {
        const runId = button.getAttribute("data-run-id");
        if (!runId) return;
        if (result) result.textContent = "Running...";
        await showResponse(await fetch("/api/projects/" + encodeURIComponent(projectId) + "/runs/" + encodeURIComponent(runId) + "/stop", {
          method: "POST",
        }));
      });
    });
  </script>`;
}

function clientScript(projectId: string): string {
  return `<script>
    const projectId = ${JSON.stringify(projectId)};
    const result = document.getElementById("action-result");
    async function postJson(url, body) {
      if (result) result.textContent = "Running...";
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (result) result.textContent = JSON.stringify(json, null, 2);
        return;
      }
      location.reload();
    }
    document.querySelector("[data-action='approve-animation']")?.addEventListener("click", () => {
      postJson("/api/projects/" + encodeURIComponent(projectId) + "/animation-plan/approve", { approved_by: "workbench" });
    });
    document.querySelector("[data-action='source-video-import']")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      postJson("/api/projects/" + encodeURIComponent(projectId) + "/source-video/import", { source_path: data.get("source_path") });
    });
    document.querySelector("[data-action='revise']")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const scopeType = String(data.get("scope_type") || "project");
      const sceneId = String(data.get("scene_id") || "").trim();
      const scope = scopeType === "scene" ? { type: "scene", scene_id: sceneId } : { type: "project" };
      postJson("/api/projects/" + encodeURIComponent(projectId) + "/html-video/revise", { scope, request: data.get("request") });
    });
  </script>`;
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:0;background:#f6f7f9;color:#15181d;line-height:1.45}
    .page-header{padding:24px 32px;background:#fff;border-bottom:1px solid #d8dde6}
    h1{margin:8px 0 4px;font-size:28px} h2{font-size:16px;margin:0 0 12px} h3{font-size:14px;margin:0 0 8px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;padding:16px 32px 32px}
    .panel,.notice{background:#fff;border:1px solid #d8dde6;border-radius:8px;padding:16px}
    .toolbar{display:grid;grid-template-columns:minmax(180px,1fr) minmax(180px,240px) minmax(180px,1fr) auto;gap:12px;align-items:end;margin:0 0 12px}
    .run-block{border-top:1px solid #e5e9f0;padding-top:12px;margin-top:12px}
    table{width:100%;border-collapse:collapse;background:#fff} th,td{padding:10px;border-bottom:1px solid #e5e9f0;text-align:left;vertical-align:top}
    code{font-size:12px;background:#eef1f5;padding:2px 4px;border-radius:4px}
    .badge{display:inline-block;border:1px solid #c4cad4;border-radius:999px;padding:2px 8px;font-size:12px;background:#f8fafc;margin-right:4px}
    .passed,.ready{border-color:#8ac29a;background:#edf8f0}.blocked,.failed{border-color:#de8f8f;background:#fff0f0}.diagnostic_only{border-color:#d6b56d;background:#fff8df}
    .exists{color:#176b35;font-weight:600}.missing{color:#9d2b2b;font-weight:600}
    .button,button{border:1px solid #aab2bf;border-radius:6px;background:#fff;padding:7px 10px;color:#111;text-decoration:none;cursor:pointer}
    button:disabled{opacity:.5;cursor:not-allowed} label{display:block;margin:8px 0} input,select,textarea{width:100%;box-sizing:border-box;border:1px solid #c4cad4;border-radius:6px;padding:8px}
    .inline{display:flex;align-items:center;gap:8px}.inline input{width:auto}
    iframe{width:100%;min-height:320px;border:1px solid #c4cad4;border-radius:6px;background:#fff}.steps li{margin:8px 0} pre{white-space:pre-wrap;font-size:12px}
    @media (max-width:760px){.toolbar{grid-template-columns:1fr}.page-header{padding:20px}.grid{padding:12px;grid-template-columns:1fr}}
  </style>
</head>
<body>${body}</body>
</html>`;
}

function cssToken(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_-]+/g, "_");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
