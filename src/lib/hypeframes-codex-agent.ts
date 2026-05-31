import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { appendStepRun } from "./step-run-log.ts";
import { writeQaReport } from "./gate-report.ts";
import { ensureHyperframesSkills } from "./hypeframes-skills.ts";
import { detectWslCodexCli } from "./wsl-codex-detect.ts";
import { buildHypeframesAgentPrompt } from "./hypeframes-agent-prompt.ts";
import { runWslCodexExec, updateLatestCodexDiffLogs } from "./wsl-codex-runner.ts";
import { runHypeframesFileGate } from "./hypeframes-file-gate.ts";
import { forbiddenSnapshotIncludes, runCodexForbiddenPathGate } from "./codex-forbidden-path-gate.ts";
import { snapshotProjectFiles } from "./project-file-snapshot.ts";

const execFileAsync = promisify(execFile);

export async function runHypeframesCodexAgent(projectPath: string): Promise<void> {
  await ensureHyperframesSkills(projectPath);
  const mode = process.env.QIVANCE_HYPEFRAMES_AGENT ?? "wsl_codex_optional";
  const detection = await detectWslCodexCli({ projectPath });
  if (!detection.ok) {
    await writeQaReport(projectPath, "qa/hypeframes/wsl_codex_agent_qa_report.json", {
      gate_name: "WSL Codex HypeFrames Agent",
      status: mode === "wsl_codex_required" ? "rule_fail_blocked" : "skipped",
      blocking_issues: mode === "wsl_codex_required"
        ? ["QIVANCE_HYPEFRAMES_AGENT=wsl_codex_required but WSL Codex CLI is not available."]
        : [],
      warnings: mode === "wsl_codex_required"
        ? []
        : ["WSL Codex CLI is not available; skipped Codex agent and kept deterministic HypeFrames output."],
      input_artifacts: ["logs/codex/wsl_codex_detection.json"],
      output_artifacts: ["qa/hypeframes/wsl_codex_agent_qa_report.json"],
    });
    await appendStepRun(projectPath, {
      step_type: "wsl_codex_hypeframes_agent",
      status: mode === "wsl_codex_required" ? "failed_blocked" : "skipped",
      provider: "wsl_codex",
      input_artifacts: ["logs/codex/wsl_codex_detection.json"],
      output_artifacts: ["qa/hypeframes/wsl_codex_agent_qa_report.json"],
      qa_report_ids: ["qa/hypeframes/wsl_codex_availability_qa_report.json"],
    });
    if (mode === "wsl_codex_required") {
      throw new Error("WSL Codex CLI is required but unavailable.");
    }
    return;
  }

  await ensureHypeframesGitRepo(projectPath);
  const before = await snapshotProjectFiles({ projectPath, include: forbiddenSnapshotIncludes() });
  const prompt = await buildHypeframesAgentPrompt(projectPath);
  const run = await runWslCodexExec({
    projectPath,
    cwdRelativePath: "hypeframes",
    prompt,
    model: process.env.QIVANCE_CODEX_MODEL,
    detection,
  });
  const changedFiles = await gitOutput(projectPath, ["diff", "--name-only"]);
  const diffstat = await gitOutput(projectPath, ["diff", "--stat"]);
  const changedFileList = changedFiles.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  await updateLatestCodexDiffLogs(projectPath, run.runId, diffstat, changedFileList);
  const after = await snapshotProjectFiles({ projectPath, include: forbiddenSnapshotIncludes() });
  await runCodexForbiddenPathGate({ projectPath, before, after, changedFilesFromGit: changedFileList });
  await runHypeframesFileGate(projectPath);
  await writeQaReport(projectPath, "qa/hypeframes/wsl_codex_agent_qa_report.json", {
    gate_name: "WSL Codex HypeFrames Agent",
    status: run.exitCode === 0 ? "rule_pass" : "rule_fail_blocked",
    blocking_issues: run.exitCode === 0 ? [] : ["WSL Codex CLI exited non-zero."],
    input_artifacts: ["hypeframes/src/index.html", "logs/codex/wsl_codex_detection.json"],
    output_artifacts: [
      run.logPaths.prompt,
      run.logPaths.stdoutJsonl,
      run.logPaths.stderr,
      run.logPaths.finalMessage,
      run.logPaths.summary,
      run.logPaths.diffstat,
      run.logPaths.changedFiles,
      "qa/hypeframes/codex_forbidden_path_qa_report.json",
    ],
  });
  await appendStepRun(projectPath, {
    step_type: "wsl_codex_hypeframes_agent",
    status: run.exitCode === 0 ? "succeeded" : "failed_blocked",
    provider: "wsl_codex",
    input_artifacts: ["hypeframes/src/index.html"],
    output_artifacts: [run.logPaths.summary, run.logPaths.changedFiles],
    qa_report_ids: [
      "qa/hypeframes/wsl_codex_agent_qa_report.json",
      "qa/hypeframes/codex_forbidden_path_qa_report.json",
      "qa/hypeframes/hypeframes_file_qa_report.json",
    ],
  });
}

async function ensureHypeframesGitRepo(projectPath: string): Promise<void> {
  const cwd = path.join(projectPath, "hypeframes");
  await execFileAsync("git", ["init"], { cwd });
  await execFileAsync("git", ["add", "."], { cwd });
  try {
    await execFileAsync("git", [
      "-c",
      "user.email=qivance@example.local",
      "-c",
      "user.name=Qivance",
      "commit",
      "-m",
      "baseline deterministic hypeframes project",
    ], { cwd });
  } catch {
    // No baseline changes to commit is acceptable.
  }
}

async function gitOutput(projectPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: path.join(projectPath, "hypeframes"),
    maxBuffer: 1024 * 1024,
  });
  return String(stdout);
}
