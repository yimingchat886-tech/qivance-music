import { readFile } from "node:fs/promises";

export type HtmlVideoAgentRuntimeInput = {
  projectDir: string;
  promptPath: string;
  agentId?: string;
  model?: string;
};

type RuntimeAgentDef = { id: string; name?: string };
type RuntimeAgentEvent =
  | { type: "text"; chunk: string }
  | { type: "error"; message: string }
  | { type: string; [key: string]: unknown };
type RuntimeSpawnHandle = {
  pid: number;
  stop(): void;
  done: Promise<{ exitCode: number; signal: NodeJS.Signals | null }>;
};

export type HtmlVideoRuntimeDeps = {
  findAgent(id: string): RuntimeAgentDef | undefined;
  spawnAgent(input: {
    def: RuntimeAgentDef;
    prompt: string;
    context: { cwd: string; extraAllowedDirs?: string[]; model?: string };
    onEvent?: (event: RuntimeAgentEvent) => void;
  }): RuntimeSpawnHandle;
};

export type HtmlVideoAgentRuntimeResult = {
  agentId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function runHtmlVideoAgentRuntime(input: HtmlVideoAgentRuntimeInput): Promise<HtmlVideoAgentRuntimeResult> {
  const runtime = await import("@html-video/runtime");
  return runHtmlVideoAgentRuntimeWithDeps(input, {
    findAgent: runtime.findAgent as HtmlVideoRuntimeDeps["findAgent"],
    spawnAgent: runtime.spawnAgent as HtmlVideoRuntimeDeps["spawnAgent"],
  });
}

export async function runHtmlVideoAgentRuntimeWithDeps(
  input: HtmlVideoAgentRuntimeInput,
  deps: HtmlVideoRuntimeDeps,
): Promise<HtmlVideoAgentRuntimeResult> {
  const agentId = input.agentId ?? "codex";
  const def = deps.findAgent(agentId);
  if (!def) {
    throw new Error(`html-video agent runtime not found: ${agentId}`);
  }

  const prompt = await readFile(input.promptPath, "utf8");
  let stdout = "";
  let stderr = "";
  const handle = deps.spawnAgent({
    def,
    prompt,
    context: {
      cwd: input.projectDir,
      extraAllowedDirs: [input.projectDir],
      ...(input.model ? { model: input.model } : {}),
    },
    onEvent: (event) => {
      if (event.type === "text") stdout += event.chunk;
      if (event.type === "error") stderr += event.message;
    },
  });

  const done = await handle.done;
  return {
    agentId,
    exitCode: done.exitCode,
    stdout,
    stderr,
  };
}
