import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readHypeframesAgentContext, writeHypeframesAgentContext } from "../src/lib/hypeframes-agent-context.ts";

test("writeHypeframesAgentContext summarizes music, timing, lyrics, storyboard, and render truth", async () => {
  const projectPath = await writeAgentContextFixture();

  await writeHypeframesAgentContext(projectPath);

  const context = await readHypeframesAgentContext(projectPath);
  assert.equal(context.schema_version, "qivance.hypeframes.agent_context.v1");
  assert.equal(context.project.project_id, "project_agent_context");
  assert.equal(context.track.duration_sec, 12);
  assert.equal(context.track.bpm, 120);
  assert.equal(context.track.audio_hash, "hash-ok");
  assert.equal(context.render.width, 1080);
  assert.equal(context.render.height, 1920);
  assert.equal(context.timing.beat_count, 2);
  assert.equal(context.timing.bar_count, 1);
  assert.equal(context.timing.sections[0].lyric_line_count, 2);
  assert.deepEqual(context.lyrics.sections[0].lines, ["第一句", "第二句"]);
  assert.equal(context.storyboard.scenes[0].objective, "hook impact");
  assert.equal(context.storyboard.caption_count, 2);
  assert.deepEqual(context.constraints.allowed_write_globs, [
    "hypeframes/**",
    "qa/hypeframes/**",
    "logs/codex/**",
  ]);

  const qa = JSON.parse(
    await readFile(path.join(projectPath, "qa", "hypeframes", "hypeframes_agent_context_qa_report.json"), "utf8"),
  );
  assert.equal(qa.status, "rule_pass");
  assert.deepEqual(qa.blocking_issues, []);
});

async function writeAgentContextFixture(): Promise<string> {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-agent-context-"));
  await writeJson(projectPath, "project_manifest.json", {
    project_id: "project_agent_context",
    topic: "宇宙说唱",
    main_composition: "rap-vertical",
    video_size: "9:16",
    video_width: 1080,
    video_height: 1920,
  });
  await writeJson(projectPath, "audio/music_manifest.json", {
    duration_sec: 12,
    sha256: "hash-ok",
    master_path: "audio/master/minimax_rap_master.wav",
  });
  await writeFileAt(projectPath, "audio/master/minimax_rap_master.wav", "audio");
  await writeFileAt(projectPath, "hypeframes/public_assets/audio/minimax_rap_master.wav", "audio");
  await writeJson(projectPath, "data/timing/beats.locked.json", {
    audio_hash: "hash-ok",
    bpm: 120,
    bpm_confidence: 0.91,
    downbeat_sec: 0,
    beats: [0, 0.5],
    bars: [0],
  });
  await writeJson(projectPath, "data/timing/section_map.json", {
    audio_hash: "hash-ok",
    duration_sec: 12,
    sections: [
      {
        section_id: "sec_001",
        label: "Hook",
        start_sec: 0,
        end_sec: 12,
        lyric_lines: ["第一句", "第二句"],
      },
    ],
  });
  await writeJson(projectPath, "data/lyrics/lyrics_structured.json", {
    sections: [{ label: "Hook", lines: ["第一句", "第二句"] }],
  });
  await writeJson(projectPath, "data/storyboard/scene_plan.json", {
    scenes: [
      {
        scene_id: "scene_001",
        section_id: "sec_001",
        start_sec: 0,
        end_sec: 12,
        objective: "hook impact",
        visual_nodes: ["kinetic_type"],
        safe_area: "caption_bottom",
      },
    ],
  });
  await writeJson(projectPath, "data/storyboard/caption_plan.json", {
    captions: [
      { scene_id: "scene_001", start_sec: 0, end_sec: 4, text: "第一句", safe_area: "caption_bottom" },
      { scene_id: "scene_001", start_sec: 4, end_sec: 8, text: "第二句", safe_area: "caption_bottom" },
    ],
  });
  await writeJson(projectPath, "data/storyboard/visual_plan.json", {
    visuals: [{ scene_id: "scene_001", elements: ["neon", "beat_accent"] }],
  });
  await writeJson(projectPath, "hypeframes/src/config.json", {
    width: 1080,
    height: 1920,
    fps: 30,
    duration_sec: 12,
    main_composition: "rap-vertical",
    video_size: "9:16",
    audio_path: "public_assets/audio/minimax_rap_master.wav",
  });
  return projectPath;
}

async function writeJson(projectPath: string, relativePath: string, value: unknown): Promise<void> {
  await writeFileAt(projectPath, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeFileAt(projectPath: string, relativePath: string, value: string): Promise<void> {
  const filePath = path.join(projectPath, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}
