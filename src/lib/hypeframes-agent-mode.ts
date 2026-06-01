import type { HypeframesAgentPromptMode } from "./hypeframes-agent-prompt.ts";

export type HypeframesAgentRunMode = "off" | "optional_refine" | "required_author" | "gate_repair";

export function resolveHypeframesAgentMode(env: NodeJS.ProcessEnv = process.env): HypeframesAgentRunMode {
  const raw = env.QIVANCE_HYPEFRAMES_AGENT_MODE ?? env.QIVANCE_HYPEFRAMES_AGENT ?? "required_author";
  if (raw === "off") return "off";
  if (raw === "optional_refine" || raw === "wsl_codex_optional") return "optional_refine";
  if (raw === "required_author" || raw === "wsl_codex_required") return "required_author";
  if (raw === "gate_repair") return "gate_repair";
  return "required_author";
}

export function isRequiredHypeframesAgentMode(mode: string): boolean {
  return mode === "required_author" || mode === "gate_repair" || mode === "wsl_codex_required";
}

export function promptModeForAgentRun(mode: HypeframesAgentRunMode): HypeframesAgentPromptMode {
  if (mode === "gate_repair") return "gate_repair";
  if (mode === "optional_refine") return "music_refine";
  return "music_author";
}
