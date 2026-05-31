import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { writeQaReport } from "../src/lib/gate-report.ts";
import { appendStepRun } from "../src/lib/step-run-log.ts";

test("writeQaReport writes required fields and scrubs secrets from metadata", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-gate-report-"));

  await writeQaReport(projectPath, "qa/hypeframes/test_report.json", {
    gate_name: "Test Gate",
    status: "rule_pass_with_warnings",
    warnings: ["Check this"],
    input_artifacts: ["input.json"],
    output_artifacts: ["output.json"],
    metadata: {
      safe: "visible",
      OPENAI_API_KEY: "sk-live",
      nested: { authorization: "Bearer secret", count: 1 },
    },
  });

  const report = JSON.parse(await readFile(path.join(projectPath, "qa", "hypeframes", "test_report.json"), "utf8"));
  assert.equal(report.gate_name, "Test Gate");
  assert.equal(report.status, "rule_pass_with_warnings");
  assert.equal(report.reviewer_type, "rule");
  assert.deepEqual(report.blocking_issues, []);
  assert.deepEqual(report.warnings, ["Check this"]);
  assert.deepEqual(report.auto_fixes_applied, []);
  assert.equal(typeof report.created_at, "string");
  assert.equal(report.metadata.safe, "visible");
  assert.equal(report.metadata.OPENAI_API_KEY, "[REDACTED]");
  assert.equal(report.metadata.nested.authorization, "[REDACTED]");
  assert.equal(report.metadata.nested.count, 1);
});

test("appendStepRun writes jsonl records with scrubbed metadata", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-step-run-"));

  await appendStepRun(projectPath, {
    step_type: "wsl_codex_hypeframes_agent",
    status: "succeeded",
    provider: "wsl_codex",
    input_artifacts: ["hypeframes/src/index.html"],
    output_artifacts: ["logs/codex/latest.final.md"],
    qa_report_ids: ["qa/hypeframes/wsl_codex_agent_qa_report.json"],
    metadata: { token: "secret", safe: true },
  });

  const lines = (await readFile(path.join(projectPath, "logs", "step_runs.jsonl"), "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.step_type, "wsl_codex_hypeframes_agent");
  assert.equal(record.status, "succeeded");
  assert.equal(record.provider, "wsl_codex");
  assert.equal(record.metadata.token, "[REDACTED]");
  assert.equal(record.metadata.safe, true);
  assert.equal(typeof record.created_at, "string");
});
