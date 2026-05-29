import { readFile } from "node:fs/promises";
import path from "node:path";

export type GateProgressStatus = "pending" | "running" | "pass" | "warning" | "fail";

export type GateProgressStep = {
  id: string;
  label: string;
  status: GateProgressStatus;
  issues: string[];
  warnings: string[];
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
    id: "hyperframes_ui",
    label: "HyperFrames UI",
    qaPath: "logs/hyperframes_ui.json",
    runningStates: ["preview_rendering", "preview_rendered", "preview_waiting_human"],
  },
] as const;

export async function loadGateProgress(projectPath: string): Promise<GateProgressStep[]> {
  const workflowState = await currentWorkflowState(projectPath);
  return Promise.all(
    gateSteps.map(async (step) => {
      const report = await readOptionalJson<QaReport>(path.join(projectPath, step.qaPath));
      if (report) {
        return {
          id: step.id,
          label: step.label,
          status: statusFromReport(report),
          issues: stringArray(report.blocking_issues),
          warnings: stringArray(report.warnings),
        };
      }
      return {
        id: step.id,
        label: step.label,
        status: step.runningStates.includes(workflowState) ? "running" : "pending",
        issues: [],
        warnings: [],
      };
    }),
  );
}

function statusFromReport(report: QaReport): GateProgressStatus {
  if (report.status === "rule_fail_blocked") return "fail";
  if (report.status === "rule_pass_with_warnings" || report.status === "human_pending") return "warning";
  if (report.status === "rule_pass" || report.status === "human_approved" || report.status === "running") return "pass";
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
