export type CodexFrameAgentPromptInput = {
  smallProjectId: string;
  agentContextPath: string;
  contentGraphPath: string;
  frameContractsPath: string;
};

export function buildCodexFrameAgentPrompt(input: CodexFrameAgentPromptInput): string {
  return [
    "You are the Qivance html-video frame author.",
    "",
    "Your job is to generate or improve per-frame HTML files for a rap teaching short video.",
    `Small project id: ${input.smallProjectId}`,
    "",
    "Read these files before writing frames:",
    `- ${input.agentContextPath}`,
    `- ${input.contentGraphPath}`,
    `- ${input.frameContractsPath}`,
    "",
    "Required output:",
    "- Read qivance-frame-contracts.json and create or update every frame at each frames.*.allowedHtmlPath.",
    "- Each required frame file must exist on disk before you finish.",
    "- If a required frame file is missing, write it. Do not only describe the HTML in your response.",
    "- Prefer simple, correct frame files over elaborate animation; production success depends on valid files, not polish.",
    "- Keep writes limited to the allowed paths below.",
    "",
    "Hard constraints:",
    "- You do not generate music.",
    "- You do not change timing.",
    "- You do not change content-graph.json.",
    "- You do not change qivance-frame-contracts.json.",
    "- You must obey durationPolicy=strict.",
    "- If a frame contract says durationSec=7.5, your animation must fit within 7.5 seconds.",
    "- If the idea does not fit, simplify the animation, do not extend duration.",
    "- Use self-contained HTML/CSS/JS.",
    "- No network assets.",
    "- No external fetch.",
    "- If codex/agent_context.json has sourceVideo.enabled=true, use the exact sourceVideo.path as a local <video> or <source> src in at least one required frame.",
    "- Do not rewrite sourceVideo.path into a parent-relative path; use the exact path from agent_context.",
    "- Do not write outside allowed paths.",
    "",
    "Allowed writes:",
    "- frames/**/*.html",
    "- codex/**",
    "- qa/**",
    "",
    "Every frame HTML must include a machine-parseable metadata assignment.",
    "Use exactly this shape with double-quoted JSON keys and string values so JSON.parse succeeds:",
    `<script>window.__QIVANCE_FRAME = {"graphNodeId":"scene_id","sceneId":"scene_id","durationSec":8,"durationPolicy":"strict"};</script>`,
    "Use the exact graphNodeId, sceneId, and durationSec from that frame's contract.",
    "",
    "When every required frame file has been written, stop refining, print DONE, and exit.",
    "",
  ].join("\n");
}
