import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildHypeframesAgentPrompt } from "../src/lib/hypeframes-agent-prompt.ts";

test("buildHypeframesAgentPrompt creates a music_author prompt from agent context", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-agent-prompt-"));
  await writeJson(projectPath, "hypeframes/generated/agent_context.json", {
    schema_version: "qivance.hypeframes.agent_context.v1",
    project: { project_id: "project_prompt", topic: "星际节拍", style_preset: "cyber-neon-rap" },
    track: { duration_sec: 9, bpm: 96, master_audio_path: "audio/master/minimax_rap_master.wav" },
    render: { width: 1080, height: 1920, fps: 30, main_composition: "rap-vertical" },
    timing: { beat_count: 12, bar_count: 3, sections: [{ section_id: "sec_001", label: "Hook" }] },
    storyboard: { caption_count: 4, visual_style_tokens: ["neon", "kinetic_type"] },
  });

  const prompt = await buildHypeframesAgentPrompt({ projectPath, mode: "music_author" });

  assert.match(prompt, /Qivance music-video composition agent/);
  assert.match(prompt, /mode: music_author/);
  assert.match(prompt, /hypeframes\/generated\/agent_context\.json/);
  assert.match(prompt, /music, lyrics, timing, captions, scenes, and visual plan/);
  assert.match(prompt, /Do not modify source-of-truth inputs/);
  assert.match(prompt, /data\/timing\/\*\*/);
  assert.match(prompt, /public_assets\/audio\/minimax_rap_master\.wav/);
  assert.match(prompt, /project_prompt/);
  assert.doesNotMatch(prompt, /Refine the generated Qivance HypeFrames HTML composition/);
});

async function writeJson(projectPath: string, relativePath: string, value: unknown): Promise<void> {
  const filePath = path.join(projectPath, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
