import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { writeJson } from "./fs-utils.ts";

export type ArtifactStatus = "pending" | "running" | "ready" | "warning" | "failed";

export type ArtifactItem = {
  label: string;
  relativePath: string;
  required: boolean;
  exists: boolean;
  sizeBytes: number | null;
  sha256: string | null;
  contentType: string;
};

export type ArtifactGroup = {
  id: string;
  label: string;
  description: string;
  qaPath: string | null;
  status: ArtifactStatus;
  artifacts: ArtifactItem[];
};

type ArtifactDefinition = {
  label: string;
  relativePath: string;
  required?: boolean;
  globPrefix?: string;
};

type ArtifactGroupDefinition = {
  id: string;
  label: string;
  description: string;
  qaPath: string | null;
  artifacts: ArtifactDefinition[];
};

type LoadArtifactCatalogOptions = {
  includeHashes?: boolean;
};

const groupDefinitions: ArtifactGroupDefinition[] = [
  {
    id: "music_ingest",
    label: "Music Lock / Audio Ingest",
    description: "Local locked audio, analysis audio, source request manifest, and ingest QA.",
    qaPath: "qa/music/music_ingest_qa_report.json",
    artifacts: [
      {
        label: "Raw MiniMax audio",
        relativePath: "audio/raw/minimax_rap_raw.*",
        globPrefix: "audio/raw/minimax_rap_raw",
      },
      { label: "Master WAV", relativePath: "audio/master/minimax_rap_master.wav" },
      { label: "Analysis WAV", relativePath: "audio/analysis/minimax_rap_analysis.wav" },
      { label: "Music manifest", relativePath: "audio/music_manifest.json" },
      { label: "MiniMax request manifest", relativePath: "audio/minimax_request_manifest.json" },
      { label: "Music ingest QA", relativePath: "qa/music/music_ingest_qa_report.json" },
    ],
  },
  {
    id: "beat_lock",
    label: "Beat Lock",
    description: "Automatic and locked beat timing artifacts.",
    qaPath: "qa/timing/beat_lock_qa_report.json",
    artifacts: [
      { label: "Automatic beats", relativePath: "data/timing/beats.auto.json" },
      { label: "Locked beats", relativePath: "data/timing/beats.locked.json" },
      { label: "Beat diagnostics", relativePath: "data/timing/beat_diagnostics.md" },
      { label: "Beat lock QA", relativePath: "qa/timing/beat_lock_qa_report.json" },
    ],
  },
  {
    id: "timing_schema",
    label: "Timing Schema Gate",
    description: "Section map, density report, and timing QA.",
    qaPath: "qa/timing/timing_qa_report.json",
    artifacts: [
      { label: "Section map", relativePath: "data/timing/section_map.json" },
      { label: "Section density report", relativePath: "data/timing/section_density_report.json" },
      { label: "Timing QA", relativePath: "qa/timing/timing_qa_report.json" },
    ],
  },
  {
    id: "storyboard_gate",
    label: "Storyboard / Scene Rule Gate",
    description: "Storyboard plans, render plan, rule check, and human approval.",
    qaPath: "qa/storyboard/scene_rule_check.json",
    artifacts: [
      { label: "Scene plan", relativePath: "data/storyboard/scene_plan.json" },
      { label: "Caption plan", relativePath: "data/storyboard/caption_plan.json" },
      { label: "Visual plan", relativePath: "data/storyboard/visual_plan.json" },
      { label: "Render plan", relativePath: "data/storyboard/render_plan.json" },
      { label: "Scene rule check", relativePath: "qa/storyboard/scene_rule_check.json" },
      { label: "Scene human approval", relativePath: "qa/storyboard/scene_human_approval.md", required: false },
    ],
  },
  {
    id: "hypeframes_project",
    label: "HypeFrames Project",
    description: "Generated HypeFrames source project and file QA.",
    qaPath: "qa/hypeframes/hypeframes_file_qa_report.json",
    artifacts: [
      { label: "Design notes", relativePath: "hypeframes/DESIGN.md" },
      { label: "Entry HTML", relativePath: "hypeframes/src/index.html" },
      { label: "Styles", relativePath: "hypeframes/src/styles.css" },
      { label: "Main script", relativePath: "hypeframes/src/main.js" },
      { label: "Config", relativePath: "hypeframes/src/config.json" },
      { label: "Timeline", relativePath: "hypeframes/generated/timeline.json" },
      { label: "Generated scene plan", relativePath: "hypeframes/generated/scene_plan.json" },
      { label: "Generated caption plan", relativePath: "hypeframes/generated/caption_plan.json" },
      { label: "Generated visual plan", relativePath: "hypeframes/generated/visual_plan.json" },
      { label: "Agent context", relativePath: "hypeframes/generated/agent_context.json" },
      { label: "Agent context QA", relativePath: "qa/hypeframes/hypeframes_agent_context_qa_report.json" },
      { label: "Music video contract QA", relativePath: "qa/hypeframes/hypeframes_music_video_contract_qa_report.json" },
      { label: "Render targets", relativePath: "hypeframes/render_targets/render_targets.json" },
      { label: "HypeFrames manifest", relativePath: "hypeframes/hypeframes_project_manifest.json" },
      { label: "HypeFrames file QA", relativePath: "qa/hypeframes/hypeframes_file_qa_report.json" },
      { label: "HyperFrames skills QA", relativePath: "qa/hypeframes/hyperframes_skills_qa_report.json", required: false },
      { label: "HyperFrames composition skill", relativePath: "hypeframes/.agents/skills/hyperframes-composition/SKILL.md", required: false },
      { label: "HyperFrames render CLI skill", relativePath: "hypeframes/.agents/skills/hyperframes-render-cli/SKILL.md", required: false },
      { label: "HyperFrames gate repair skill", relativePath: "hypeframes/.agents/skills/hyperframes-gate-repair/SKILL.md", required: false },
      { label: "HypeFrames revision notes", relativePath: "qa/hypeframes/hypeframes_revision_notes.md", required: false },
    ],
  },
  {
    id: "wsl_codex_agent",
    label: "WSL Codex Agent",
    description: "WSL Codex CLI detection, execution logs, JSONL events, final summary, and diff metadata.",
    qaPath: "qa/hypeframes/wsl_codex_agent_qa_report.json",
    artifacts: [
      { label: "WSL Codex detection", relativePath: "logs/codex/wsl_codex_detection.json", required: false },
      { label: "WSL Codex availability QA", relativePath: "qa/hypeframes/wsl_codex_availability_qa_report.json", required: false },
      { label: "Latest Codex prompt", relativePath: "logs/codex/latest.prompt.md", required: false },
      { label: "Latest Codex stdout JSONL", relativePath: "logs/codex/latest.stdout.jsonl", required: false },
      { label: "Latest Codex stderr", relativePath: "logs/codex/latest.stderr.log", required: false },
      { label: "Latest Codex final", relativePath: "logs/codex/latest.final.md", required: false },
      { label: "Latest Codex summary", relativePath: "logs/codex/latest.summary.json", required: false },
      { label: "Latest Codex diffstat", relativePath: "logs/codex/latest.diffstat.txt", required: false },
      { label: "Latest Codex changed files", relativePath: "logs/codex/latest.changed_files.json", required: false },
      { label: "Codex forbidden path QA", relativePath: "qa/hypeframes/codex_forbidden_path_qa_report.json", required: false },
      { label: "WSL Codex agent QA", relativePath: "qa/hypeframes/wsl_codex_agent_qa_report.json", required: false },
    ],
  },
  {
    id: "render_preview",
    label: "Render / Preview QA",
    description: "Rendered preview, review assets, render QA, and final approved output.",
    qaPath: "qa/render/render_qa_report.json",
    artifacts: [
      { label: "Preview MP4", relativePath: "dist/preview/preview_composite.mp4" },
      { label: "Review MP4", relativePath: "dist/review/preview_composite_review.mp4" },
      { label: "Render manifest", relativePath: "dist/render_manifest.json" },
      { label: "Render QA", relativePath: "qa/render/render_qa_report.json" },
      { label: "Keyframes contact sheet", relativePath: "qa/render/keyframes_contact_sheet.jpg" },
      { label: "Preview review log", relativePath: "qa/render/preview_review_log.md", required: false },
      { label: "Master QA", relativePath: "qa/master_qa_report.json", required: false },
      { label: "Final HypeFrames video", relativePath: "dist/final/hypeframes_final.mp4", required: false },
    ],
  },
];

export async function loadArtifactCatalog(
  projectPath: string,
  options: LoadArtifactCatalogOptions = {},
): Promise<ArtifactGroup[]> {
  const includeHashes = options.includeHashes ?? true;
  return Promise.all(
    groupDefinitions.map(async (definition) => {
      const artifacts = await resolveArtifacts(projectPath, definition.artifacts, includeHashes);
      const qaReport = definition.qaPath
        ? await readOptionalJson<{ status?: unknown }>(path.join(projectPath, definition.qaPath))
        : null;

      return {
        id: definition.id,
        label: definition.label,
        description: definition.description,
        qaPath: definition.qaPath,
        status: statusFromQaAndArtifacts(qaReport?.status, artifacts),
        artifacts,
      };
    }),
  );
}

export async function writeArtifactSnapshot(projectPath: string): Promise<void> {
  const manifest = await readOptionalJson<Record<string, unknown>>(path.join(projectPath, "project_manifest.json"));
  await writeJson(path.join(projectPath, "artifact_manifest.json"), {
    project_id: typeof manifest?.project_id === "string" ? manifest.project_id : path.basename(projectPath),
    updated_at: new Date().toISOString(),
    groups: await loadArtifactCatalog(projectPath),
  });
}

async function resolveArtifacts(
  projectPath: string,
  definitions: ArtifactDefinition[],
  includeHashes: boolean,
): Promise<ArtifactItem[]> {
  const items: ArtifactItem[] = [];
  for (const definition of definitions) {
    const relativePaths = definition.globPrefix
      ? await expandRawAudioGlob(projectPath, definition.globPrefix)
      : [definition.relativePath];

    if (relativePaths.length === 0) {
      items.push(await artifactItem(projectPath, definition, definition.relativePath, includeHashes));
      continue;
    }

    for (const relativePath of relativePaths) {
      items.push(await artifactItem(projectPath, definition, relativePath, includeHashes));
    }
  }
  return items;
}

async function expandRawAudioGlob(projectPath: string, globPrefix: string): Promise<string[]> {
  const directory = path.dirname(globPrefix);
  const prefix = path.basename(globPrefix);
  try {
    const entries = await readdir(path.join(projectPath, directory), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix + "."))
      .map((entry) => path.posix.join(directory, entry.name))
      .sort();
  } catch {
    return [];
  }
}

async function artifactItem(
  projectPath: string,
  definition: ArtifactDefinition,
  relativePath: string,
  includeHashes: boolean,
): Promise<ArtifactItem> {
  const absolutePath = path.join(projectPath, relativePath);
  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      return missingArtifact(definition, relativePath);
    }

    return {
      label: definition.label,
      relativePath,
      required: definition.required ?? true,
      exists: true,
      sizeBytes: fileStat.size,
      sha256: includeHashes ? await sha256File(absolutePath) : null,
      contentType: contentType(relativePath),
    };
  } catch {
    return missingArtifact(definition, relativePath);
  }
}

function missingArtifact(definition: ArtifactDefinition, relativePath: string): ArtifactItem {
  return {
    label: definition.label,
    relativePath,
    required: definition.required ?? true,
    exists: false,
    sizeBytes: null,
    sha256: null,
    contentType: contentType(relativePath),
  };
}

function statusFromQaAndArtifacts(status: unknown, artifacts: ArtifactItem[]): ArtifactStatus {
  if (status === "rule_fail_blocked") return "failed";
  if (status === "rule_pass_with_warnings" || status === "human_pending") return "warning";
  if (status === "rule_pass" || status === "human_approved") return "ready";
  return artifacts.some((artifact) => artifact.exists) ? "running" : "pending";
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function readOptionalJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function contentType(relativePath: string): string {
  if (relativePath.endsWith(".mp4")) return "video/mp4";
  if (relativePath.endsWith(".wav")) return "audio/wav";
  if (relativePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (relativePath.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (relativePath.endsWith(".jpg") || relativePath.endsWith(".jpeg")) return "image/jpeg";
  if (relativePath.endsWith(".log") || relativePath.endsWith(".txt") || relativePath.endsWith(".jsonl")) return "text/plain; charset=utf-8";
  if (relativePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (relativePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (relativePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}
