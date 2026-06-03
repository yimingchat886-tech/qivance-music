import { readFile } from "node:fs/promises";
import path from "node:path";

export type HypeframesAgentPromptMode = "music_author" | "music_refine" | "gate_repair";

export type BuildHypeframesAgentPromptInput = {
  projectPath: string;
  mode?: HypeframesAgentPromptMode;
};

export async function buildHypeframesAgentPrompt(
  input: string | BuildHypeframesAgentPromptInput,
): Promise<string> {
  const projectPath = typeof input === "string" ? input : input.projectPath;
  const mode = typeof input === "string" ? "music_refine" : input.mode ?? "music_author";
  const context = await readOptionalAgentContext(projectPath);
  const summary = context
    ? renderContextSummary(context)
    : "- agent_context: not found yet; read the source-of-truth files directly.";

  return [
    "# System instructions",
    "",
    "You are the Qivance music-video composition agent.",
    "Your job is to create a HyperFrames HTML composition for the imported song.",
    "The user is not providing a free-form prompt in this step. Treat the project files and Qivance system instructions as the task. Use the generated music, lyrics, timing, captions, scenes, and visual plan as source-of-truth.",
    "",
    `mode: ${mode}`,
    "",
    "# Mission",
    "",
    "Create or substantially improve the HyperFrames composition so that the final MP4 feels synchronized with the locked music, lyrics, beat grid, section map, captions, and storyboard.",
    mode === "gate_repair"
      ? "Focus only on fixing blocking QA issues. Keep source-of-truth files unchanged."
      : mode === "music_refine"
        ? "Refine the existing scaffold only where it improves music synchronization, caption readability, or section-aware motion."
        : "Author the composition as a music-conditioned video, not as a static presentation.",
    "",
    "# Source of truth",
    "",
    "Read these files from the project root:",
    "",
    "- audio/music_manifest.json",
    "- data/timing/beats.locked.json",
    "- data/timing/section_map.json",
    "- data/lyrics/lyrics_structured.json",
    "- data/storyboard/scene_plan.json",
    "- data/storyboard/caption_plan.json",
    "- data/storyboard/visual_plan.json",
    "- hypeframes/generated/agent_context.json",
    "- hypeframes/src/config.json",
    "",
    "Do not modify source-of-truth inputs under audio/**, data/timing/**, data/lyrics/**, qa/music/**, qa/timing/**, dist/**, project_manifest.json, or workflow_snapshot.json.",
    "",
    "# Agent context summary",
    "",
    summary,
    "",
    "# HyperFrames output requirements",
    "",
    "You may modify:",
    "",
    "- hypeframes/src/index.html",
    "- hypeframes/src/styles.css",
    "- hypeframes/src/main.js",
    "- hypeframes/src/config.json",
    "- hypeframes/generated/** only for derived render metadata",
    "- hypeframes/DESIGN.md",
    "- qa/hypeframes/hypeframes_revision_notes.md",
    "",
    "The composition must:",
    "",
    "- use the locked duration from hypeframes/src/config.json or agent_context.json;",
    "- load the locked master audio via public_assets/audio/minimax_rap_master.wav or leave it for Qivance render muxing;",
    "- align scene changes to section_map and important visual accents to beats or bars;",
    "- display captions from caption_plan with safe-area awareness;",
    "- implement section-specific visual motifs from scene_plan and visual_plan;",
    "- expose a renderable HyperFrames/GSAP timeline through window.__timelines;",
    "- avoid external URLs, random network dependencies, Date.now(), and Math.random();",
    "- be deterministic and renderable offline.",
    "",
    "# Creative direction",
    "",
    "Use a music-video language rather than a static presentation:",
    "",
    "- beat-reactive motion on downbeats and bar transitions;",
    "- clear hierarchy between hook, verse, bridge, and outro;",
    "- readable lyric captions;",
    "- visual motifs that repeat with variation across sections;",
    "- no review markers in preview_composite.",
    "",
    "# Completion checklist",
    "",
    "Before finishing:",
    "",
    "- ensure hypeframes/src/index.html exists and references local assets only;",
    "- ensure hypeframes/src/main.js builds the timeline synchronously;",
    "- ensure hypeframes/src/styles.css supports the configured resolution;",
    "- write concise revision notes to qa/hypeframes/hypeframes_revision_notes.md;",
    "- do not render final MP4 from Codex shell;",
    "- do not claim QA pass; the Qivance daemon will run QA and render.",
    "",
  ].join("\n");
}

async function readOptionalAgentContext(projectPath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path.join(projectPath, "hypeframes", "generated", "agent_context.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function renderContextSummary(context: Record<string, unknown>): string {
  const project = recordValue(context.project);
  const track = recordValue(context.track);
  const render = recordValue(context.render);
  const timing = recordValue(context.timing);
  const storyboard = recordValue(context.storyboard);
  return [
    `- project_id: ${stringValue(project?.project_id) ?? "unknown"}`,
    `- topic: ${stringValue(project?.topic) ?? "none"}`,
    `- duration_sec: ${numberValue(track?.duration_sec) ?? "unknown"}`,
    `- bpm: ${numberValue(track?.bpm) ?? "unknown"}`,
    `- master_audio: ${stringValue(track?.master_audio_path) ?? "audio/master/minimax_rap_master.wav"}`,
    `- render: ${numberValue(render?.width) ?? "?"}x${numberValue(render?.height) ?? "?"} @ ${numberValue(render?.fps) ?? "?"}fps`,
    `- main_composition: ${stringValue(render?.main_composition) ?? "unknown"}`,
    `- beat_count: ${numberValue(timing?.beat_count) ?? "unknown"}`,
    `- bar_count: ${numberValue(timing?.bar_count) ?? "unknown"}`,
    `- caption_count: ${numberValue(storyboard?.caption_count) ?? "unknown"}`,
  ].join("\n");
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
