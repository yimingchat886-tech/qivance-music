import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SmallProjectPaths } from "../project-core/paths.ts";

export type AgentRunMode = "production" | "diagnostic";
export type AgentRunOperation = "run_agent" | "revise";
export type AgentRunValidation = {
  passed: boolean;
  issues: string[];
};

export type AgentRunLog = {
  schema_version: 1;
  agent_run_id: string;
  small_project_id: string;
  mode: AgentRunMode;
  operation: AgentRunOperation;
  scope: { type: "project" } | { type: "scene"; scene_id: string };
  input_artifacts: string[];
  started_at: string;
  finished_at: string;
  exit_code: number;
  timed_out: boolean;
  changed_files: string[];
  ai_authored_frame_paths: string[];
  validation: AgentRunValidation;
  diagnostics: string[];
};

export type AgentRunProductionGateResult = {
  ok: boolean;
  status: "passed" | "failed" | "diagnostic_only";
  issues: string[];
};

export function buildAgentRunLog(input: {
  smallProjectId: string;
  mode: AgentRunMode;
  operation: AgentRunOperation;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  timedOut?: boolean;
  changedFiles: string[];
  frameValidation: AgentRunValidation;
  fallbackFramePaths?: string[];
  forbiddenChangedFiles?: string[];
  diagnostics?: string[];
  allowDiagnosticFallback?: boolean;
  scope?: AgentRunLog["scope"];
  inputArtifacts?: string[];
  agentRunId?: string;
}): AgentRunLog {
  const aiAuthoredFramePaths = aiAuthoredFramePathsFromChangedFiles(input.changedFiles, input.fallbackFramePaths ?? []);
  const gate = validateAgentRunProductionGate({
    mode: input.mode,
    exitCode: input.exitCode,
    timedOut: input.timedOut,
    aiAuthoredFramePaths,
    fallbackFramePaths: input.fallbackFramePaths ?? [],
    forbiddenChangedFiles: input.forbiddenChangedFiles ?? [],
    frameValidation: input.frameValidation,
    allowDiagnosticFallback: input.allowDiagnosticFallback,
  });
  const validationIssues = uniqueIssues([...input.frameValidation.issues, ...gate.issues]);
  return {
    schema_version: 1,
    agent_run_id: input.agentRunId ?? agentRunId(input.startedAt),
    small_project_id: input.smallProjectId,
    mode: input.mode,
    operation: input.operation,
    scope: input.scope ?? { type: "project" },
    input_artifacts: input.inputArtifacts ?? [
      "content-graph.json",
      "qivance-frame-contracts.json",
      "codex/agent_context.json",
    ],
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    exit_code: input.exitCode,
    timed_out: Boolean(input.timedOut),
    changed_files: input.changedFiles,
    ai_authored_frame_paths: aiAuthoredFramePaths,
    validation: {
      passed: input.frameValidation.passed && gate.ok,
      issues: validationIssues,
    },
    diagnostics: input.diagnostics ?? [],
  };
}

export function validateAgentRunProductionGate(input: {
  mode: AgentRunMode;
  exitCode: number;
  timedOut?: boolean;
  aiAuthoredFramePaths: string[];
  fallbackFramePaths?: string[];
  forbiddenChangedFiles?: string[];
  frameValidation: AgentRunValidation;
  allowDiagnosticFallback?: boolean;
}): AgentRunProductionGateResult {
  const issues: string[] = [];
  const fallbackFramePaths = input.fallbackFramePaths ?? [];
  const forbiddenChangedFiles = input.forbiddenChangedFiles ?? [];

  if (input.mode === "diagnostic") {
    if (fallbackFramePaths.length > 0 && !input.allowDiagnosticFallback) {
      issues.push("diagnostic fallback frames require an explicit diagnostic fallback flag");
    }
    if (!input.frameValidation.passed) issues.push(...input.frameValidation.issues);
    return {
      ok: issues.length === 0,
      status: issues.length === 0 ? "diagnostic_only" : "failed",
      issues: uniqueIssues(issues),
    };
  }

  if (input.timedOut) issues.push("production agent run timed out");
  if (input.exitCode !== 0) issues.push(`production agent run exited with code ${input.exitCode}`);
  if (input.aiAuthoredFramePaths.length === 0) issues.push("production agent run produced no AI-authored frame paths");
  if (fallbackFramePaths.length > 0) {
    issues.push(`production agent run used fallback frames: ${fallbackFramePaths.join(", ")}`);
  }
  if (forbiddenChangedFiles.length > 0) {
    issues.push(`production agent run changed forbidden paths: ${forbiddenChangedFiles.join(", ")}`);
  }
  if (!input.frameValidation.passed) issues.push(...input.frameValidation.issues);

  return {
    ok: issues.length === 0,
    status: issues.length === 0 ? "passed" : "failed",
    issues: uniqueIssues(issues),
  };
}

export function aiAuthoredFramePathsFromChangedFiles(changedFiles: string[], fallbackFramePaths: string[] = []): string[] {
  const fallback = new Set(fallbackFramePaths.map(normalizePath));
  return changedFiles
    .map(normalizePath)
    .filter((file) => /^frames\/.+\.html$/.test(file))
    .filter((file) => !fallback.has(file))
    .sort();
}

export async function writeAgentRunLog(input: {
  paths: SmallProjectPaths;
  log: AgentRunLog;
}): Promise<{ path: string; log: AgentRunLog }> {
  const relativePath = `video/html-video/.html-video/projects/${input.paths.smallProjectId}/agent_runs/${input.log.agent_run_id}.json`;
  const absolutePath = path.join(input.paths.htmlVideoProjectDir, "agent_runs", `${input.log.agent_run_id}.json`);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(input.log, null, 2)}\n`, "utf8");
  return { path: relativePath, log: input.log };
}

function agentRunId(startedAt: string): string {
  return `agent_run_${startedAt.replaceAll(/[^0-9A-Za-z]+/g, "_").replaceAll(/^_+|_+$/g, "")}`;
}

function uniqueIssues(issues: string[]): string[] {
  return [...new Set(issues.filter(Boolean))];
}

function normalizePath(value: string): string {
  return value.replaceAll(path.sep, "/");
}
