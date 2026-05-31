import { realpath } from "node:fs/promises";
import { runWslCommand, shellQuote } from "./wsl-command.ts";

export async function toWslPath(input: {
  absolutePath: string;
  distro?: string | null;
  user?: string | null;
  wslExe?: string;
  platform?: NodeJS.Platform;
}): Promise<string> {
  const platform = input.platform ?? process.platform;
  if (platform !== "win32") {
    const resolved = await realpath(input.absolutePath);
    if (!resolved.startsWith("/")) {
      throw new Error(`Resolved project path is not absolute: ${resolved}`);
    }
    return resolved;
  }

  const result = await runWslCommand({
    wslExe: input.wslExe,
    distro: input.distro,
    user: input.user,
    script: `wslpath -a ${shellQuote(input.absolutePath)}`,
    timeoutMs: 10_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`wslpath failed: ${result.stderr || result.stdout || result.commandForLog}`);
  }
  const output = result.stdout.trim();
  if (!output.startsWith("/")) {
    throw new Error(`wslpath returned a non-absolute path: ${output}`);
  }
  return output;
}
