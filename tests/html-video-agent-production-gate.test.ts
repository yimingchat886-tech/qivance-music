import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { validateMediaE2EProductionGates } from "../src/lib/media-e2e/workflow.ts";
import { resolveSmallProjectPaths } from "../src/lib/project-core/paths.ts";
import { readWorkbenchProjectStatus } from "../src/lib/workbench/project-status.ts";
import {
  buildAgentRunLog,
  validateAgentRunProductionGate,
  writeAgentRunLog,
} from "../src/lib/video-html/agent-run-log.ts";

test("builds a passing production agent run log with AI-authored frames", () => {
  const log = buildAgentRunLog({
    smallProjectId: "sp",
    mode: "production",
    operation: "run_agent",
    startedAt: "2026-06-12T00:00:00.000Z",
    finishedAt: "2026-06-12T00:01:00.000Z",
    exitCode: 0,
    changedFiles: ["frames/scene_001.html", "codex/result.jsonl"],
    frameValidation: { passed: true, issues: [] },
  });

  assert.equal(log.schema_version, 1);
  assert.equal(log.mode, "production");
  assert.equal(log.validation.passed, true);
  assert.deepEqual(log.ai_authored_frame_paths, ["frames/scene_001.html"]);
});

test("production gate fails timeout, non-zero exit, missing frames, fallback, forbidden changes, and validation issues", () => {
  const gate = validateAgentRunProductionGate({
    mode: "production",
    exitCode: 124,
    timedOut: true,
    aiAuthoredFramePaths: [],
    fallbackFramePaths: ["frames/scene_001.html"],
    forbiddenChangedFiles: ["content-graph.json"],
    frameValidation: { passed: false, issues: ["frame metadata mismatch"] },
  });
  const issues = gate.issues.join("\n");

  assert.equal(gate.ok, false);
  assert.equal(gate.status, "failed");
  assert.match(issues, /timed out/);
  assert.match(issues, /exited with code 124/);
  assert.match(issues, /no AI-authored frame/);
  assert.match(issues, /fallback frames/);
  assert.match(issues, /forbidden paths/);
  assert.match(issues, /frame metadata mismatch/);
});

test("diagnostic fallback requires an explicit diagnostic flag and remains diagnostic-only", () => {
  const blocked = validateAgentRunProductionGate({
    mode: "diagnostic",
    exitCode: 0,
    aiAuthoredFramePaths: [],
    fallbackFramePaths: ["frames/scene_001.html"],
    frameValidation: { passed: true, issues: [] },
  });
  const allowed = validateAgentRunProductionGate({
    mode: "diagnostic",
    exitCode: 0,
    aiAuthoredFramePaths: [],
    fallbackFramePaths: ["frames/scene_001.html"],
    frameValidation: { passed: true, issues: [] },
    allowDiagnosticFallback: true,
  });

  assert.equal(blocked.ok, false);
  assert.match(blocked.issues.join("\n"), /explicit diagnostic fallback/);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.status, "diagnostic_only");
});

test("agent run logs are written where the status API can summarize them", async () => {
  const storageRoot = await mkdtemp(path.join("/tmp", "qivance-agent-run-status-"));
  const smallProjectId = "sp_agent_run";
  const paths = resolveSmallProjectPaths(storageRoot, smallProjectId);
  const log = buildAgentRunLog({
    smallProjectId,
    mode: "production",
    operation: "run_agent",
    startedAt: "2026-06-12T00:00:00.000Z",
    finishedAt: "2026-06-12T00:01:00.000Z",
    exitCode: 0,
    changedFiles: ["frames/scene_001.html"],
    frameValidation: { passed: true, issues: [] },
    agentRunId: "agent_run_test",
  });

  const written = await writeAgentRunLog({ paths, log });
  const status = await readWorkbenchProjectStatus({ storageRoot, smallProjectId });

  assert.equal(written.path, `video/html-video/.html-video/projects/${smallProjectId}/agent_runs/agent_run_test.json`);
  assert.equal(status.agent_runs.length, 1);
  assert.equal(status.agent_runs[0]?.mode, "production");
  assert.equal(status.agent_runs[0]?.operation, "run_agent");
  assert.equal(status.agent_runs[0]?.status, "passed");
});

test("media E2E production gate rejects clean exits without AI-authored frames", () => {
  const gate = validateMediaE2EProductionGates({
    cachedImagegenRequests: [],
    fallbackFramePaths: [],
    htmlVideoRuntimeExitCode: 0,
    aiAuthoredFramePaths: [],
  });

  assert.equal(gate.ok, false);
  assert.match(gate.issues.join("\n"), /AI-authored html-video frames are required/);
});
