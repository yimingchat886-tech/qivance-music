import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadArtifactCatalog } from "./artifact-catalog.ts";

export type GateProgressStatus = "pending" | "running" | "pass" | "warning" | "fail";

export type GateProgressStep = {
  id: string;
  label: string;
  status: GateProgressStatus;
  issues: string[];
  warnings: string[];
  completed: boolean;
  qaPath: string | null;
  artifactCount: number;
  availableArtifactCount: number;
};

type QaReport = {
  status?: string;
  blocking_issues?: unknown;
  warnings?: unknown;
};

const gateSteps = [
  {
    id: "music_ingest",
    label: "Music Ingest",
    qaPath: "qa/music/music_ingest_qa_report.json",
    runningStates: ["music_locking"],
  },
  {
    id: "beat_lock",
    label: "Beat Lock",
    qaPath: "qa/timing/beat_lock_qa_report.json",
    runningStates: ["beat_locking", "beat_lock_needs_review"],
  },
  {
    id: "timing_schema",
    label: "Timing Schema Gate",
    qaPath: "qa/timing/timing_qa_report.json",
    runningStates: ["section_mapping", "section_mapped", "timing_checking"],
  },
  {
    id: "storyboard_gate",
    label: "Storyboard Gate",
    qaPath: "qa/storyboard/scene_rule_check.json",
    runningStates: ["storyboard_generating", "storyboard_generated", "scene_rule_checking"],
  },
  {
    id: "hypeframes_project",
    label: "HypeFrames Project",
    qaPath: "qa/hypeframes/hypeframes_file_qa_report.json",
    runningStates: ["hypeframes_generating", "hypeframes_project_ready", "hypeframes_file_qa_checking"],
  },
  {
    id: "hyperframes_skills",
    label: "HyperFrames Skills",
    qaPath: "qa/hypeframes/hyperframes_skills_qa_report.json",
    runningStates: ["hypeframes_generating", "hypeframes_file_qa_checking"],
  },
  {
    id: "wsl_codex_agent",
    label: "WSL Codex Agent",
    qaPath: "qa/hypeframes/wsl_codex_agent_qa_report.json",
    runningStates: ["hypeframes_generating", "hypeframes_file_qa_checking"],
  },
  {
    id: "codex_forbidden_path",
    label: "Codex Forbidden Path Gate",
    qaPath: "qa/hypeframes/codex_forbidden_path_qa_report.json",
    runningStates: ["hypeframes_file_qa_checking"],
  },
  {
    id: "hyperframes_ui",
    label: "HyperFrames UI",
    qaPath: "logs/hyperframes_ui.json",
    runningStates: ["preview_rendering", "preview_rendered", "preview_waiting_human"],
  },
] as const;

type GateProgressStepId = (typeof gateSteps)[number]["id"];

const artifactGroupByStepId: Record<GateProgressStepId, string> = {
  music_ingest: "music_ingest",
  beat_lock: "beat_lock",
  timing_schema: "timing_schema",
  storyboard_gate: "storyboard_gate",
  hypeframes_project: "hypeframes_project",
  hyperframes_skills: "hypeframes_project",
  wsl_codex_agent: "wsl_codex_agent",
  codex_forbidden_path: "wsl_codex_agent",
  hyperframes_ui: "render_preview",
};

export async function loadGateProgress(projectPath: string): Promise<GateProgressStep[]> {
  const workflowState = await currentWorkflowState(projectPath);
  const artifactGroups = await loadArtifactCatalog(projectPath, { includeHashes: false });

  return Promise.all(
    gateSteps.map(async (step) => {
      const artifactGroup = artifactGroups.find((group) => group.id === artifactGroupByStepId[step.id]);
      const artifactCount = artifactGroup?.artifacts.length ?? 0;
      const availableArtifactCount = artifactGroup?.artifacts.filter((artifact) => artifact.exists).length ?? 0;
      const report = await readOptionalJson<QaReport>(path.join(projectPath, step.qaPath));

      if (report) {
        const status = statusFromReport(report);
        return {
          id: step.id,
          label: step.label,
          status,
          issues: stringArray(report.blocking_issues),
          warnings: stringArray(report.warnings),
          completed: completedFromReportStatus(report.status),
          qaPath: step.qaPath,
          artifactCount,
          availableArtifactCount,
        };
      }

      return {
        id: step.id,
        label: step.label,
        status: step.runningStates.includes(workflowState) ? "running" : "pending",
        issues: [],
        warnings: [],
        completed: false,
        qaPath: step.qaPath,
        artifactCount,
        availableArtifactCount,
      };
    }),
  );
}

function completedFromReportStatus(status: string | undefined): boolean {
  return status === "rule_pass" ||
    status === "rule_pass_with_warnings" ||
    status === "human_approved" ||
    status === "skipped";
}

function statusFromReport(report: QaReport): GateProgressStatus {
  if (report.status === "rule_fail_blocked") return "fail";
  if (report.status === "rule_pass_with_warnings" || report.status === "human_pending") return "warning";
  if (report.status === "rule_pass" || report.status === "human_approved" || report.status === "skipped") return "pass";
  if (report.status === "running") return "running";
  if (report.status === "stopped") return "warning";
  return "pending";
}

async function currentWorkflowState(projectPath: string): Promise<string> {
  const manifest = await readOptionalJson<Record<string, unknown>>(path.join(projectPath, "project_manifest.json"));
  return typeof manifest?.current_workflow_state === "string" ? manifest.current_workflow_state : "";
}

async function readOptionalJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
