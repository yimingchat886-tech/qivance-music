import { execFile } from "node:child_process";
import type { ImageGenerationAdapter, ImageGenerationRequest, ImageGenerationResult } from "./types.ts";

export type ExternalImageGenRunner = (input: {
  command: string;
  stdin: string;
}) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export function createExternalCommandImageGenerationAdapter(input: {
  command?: string;
  env?: NodeJS.ProcessEnv;
  runner?: ExternalImageGenRunner;
} = {}): ImageGenerationAdapter {
  const env = input.env ?? process.env;
  const command = input.command ?? env.QIVANCE_CODEX_IMAGE_GEN_CMD;
  const runner = input.runner ?? runExternalImageGenCommand;

  return {
    id: "codex_image_gen",
    async generateImageCandidates(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
      if (!command) {
        throw new Error("QIVANCE_CODEX_IMAGE_GEN_CMD is required for real Codex image_gen E2E execution");
      }

      const result = await runner({
        command,
        stdin: `${JSON.stringify(request)}\n`,
      });
      if (result.exitCode !== 0) {
        throw new Error(`Codex image_gen command failed with exit code ${result.exitCode}: ${result.stderr}`);
      }

      const parsed = JSON.parse(result.stdout) as ImageGenerationResult;
      if (parsed.requestId !== request.requestId) {
        throw new Error(`Codex image_gen response requestId mismatch: ${parsed.requestId}`);
      }
      if (parsed.adapterId !== "codex_image_gen") {
        throw new Error(`Codex image_gen response adapterId mismatch: ${parsed.adapterId}`);
      }
      if (parsed.status !== "succeeded") {
        throw new Error(`Codex image_gen response status is not succeeded: ${parsed.status}`);
      }
      return parsed;
    },
  };
}

export const codexImageGenAdapter: ImageGenerationAdapter = createExternalCommandImageGenerationAdapter();

async function runExternalImageGenCommand(input: {
  command: string;
  stdin: string;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return await new Promise((resolve, reject) => {
    const child = execFile(input.command, [], (error, stdout, stderr) => {
      if (error) {
        const code = typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === "number"
          ? (error as NodeJS.ErrnoException & { code: number }).code
          : 1;
        resolve({ stdout: String(stdout), stderr: String(stderr), exitCode: code });
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr), exitCode: 0 });
    });
    child.on("error", reject);
    child.stdin?.end(input.stdin);
  });
}
