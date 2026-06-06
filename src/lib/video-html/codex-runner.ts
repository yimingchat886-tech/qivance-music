import { spawn } from "node:child_process";

export type CodexExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export async function runCodexExec(input: {
  cwd: string;
  prompt: string;
  env?: NodeJS.ProcessEnv;
}): Promise<CodexExecResult> {
  return await new Promise<CodexExecResult>((resolve, reject) => {
    const child = spawn("codex", [
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "-",
    ], {
      cwd: input.cwd,
      env: {
        ...process.env,
        ...input.env,
        QIVANCE_CODEX_MODE: "html_video_frame_author",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error("Codex CLI not found. Install and authenticate Codex before running the html-video frame author demo."));
        return;
      }
      reject(error);
    });
    child.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });
    child.stdin.end(input.prompt);
  });
}
