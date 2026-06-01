import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { generateHypeframesProject } from "../src/lib/post-minimax-workflow.ts";

test("generateHypeframesProject writes agent context and music-video contract QA", async () => {
  const projectPath = await writeProjectFixture();

  await generateHypeframesProject(projectPath);

  await stat(path.join(projectPath, "hypeframes", "generated", "agent_context.json"));
  await stat(path.join(projectPath, "qa", "hypeframes", "hypeframes_agent_context_qa_report.json"));
  await stat(path.join(projectPath, "qa", "hypeframes", "hypeframes_music_video_contract_qa_report.json"));
  const context = JSON.parse(await readFile(path.join(projectPath, "hypeframes", "generated", "agent_context.json"), "utf8"));
  const contractQa = JSON.parse(
    await readFile(path.join(projectPath, "qa", "hypeframes", "hypeframes_music_video_contract_qa_report.json"), "utf8"),
  );

  assert.equal(context.schema_version, "qivance.hypeframes.agent_context.v1");
  assert.equal(context.track.audio_hash, "hash-ok");
  assert.equal(contractQa.status, "rule_pass");
});

async function writeProjectFixture(): Promise<string> {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-generate-context-"));
  await mkdir(path.join(projectPath, "hypeframes", "src"), { recursive: true });
  await mkdir(path.join(projectPath, "hypeframes", "generated"), { recursive: true });
  await mkdir(path.join(projectPath, "hypeframes", "render_targets"), { recursive: true });
  await mkdir(path.join(projectPath, "hypeframes", "public_assets", "audio"), { recursive: true });
  await writeJson(projectPath, "workflow_snapshot.json", {
    project_id: "project_generate_context",
    workflow_state: "scene_human_approved",
    next_allowed_actions: ["render_preview"],
    updated_at: new Date().toISOString(),
  });
  await writeJson(projectPath, "project_manifest.json", {
    project_id: "project_generate_context",
    topic: "测试主题",
    video_size: "1080x1920",
    main_composition: "qivance-vertical",
  });
  await writeJson(projectPath, "audio/music_manifest.json", {
    duration_sec: 8,
    sha256: "hash-ok",
    master_path: "audio/master/minimax_rap_master.wav",
  });
  await writeFileAt(projectPath, "audio/master/minimax_rap_master.wav", "audio");
  await writeJson(projectPath, "data/timing/beats.locked.json", {
    audio_hash: "hash-ok",
    bpm: 100,
    bpm_confidence: 0.8,
    downbeat_sec: 0,
    beats: [0, 0.6],
    bars: [0],
  });
  await writeJson(projectPath, "data/timing/section_map.json", {
    audio_hash: "hash-ok",
    duration_sec: 8,
    sections: [
      {
        section_id: "sec_001",
        index: 0,
        label: "Hook",
        start_sec: 0,
        end_sec: 8,
        lyric_lines: ["测试歌词"],
      },
    ],
  });
  await writeJson(projectPath, "data/lyrics/lyrics_structured.json", {
    sections: [{ label: "Hook", lines: ["测试歌词"] }],
  });
  await writeJson(projectPath, "data/storyboard/scene_plan.json", {
    scenes: [
      {
        scene_id: "scene_001",
        section_id: "sec_001",
        start_sec: 0,
        end_sec: 8,
        objective: "visual hook",
        visual_nodes: ["keyword_card"],
        safe_area: "caption_bottom",
      },
    ],
  });
  await writeJson(projectPath, "data/storyboard/caption_plan.json", {
    captions: [{ scene_id: "scene_001", start_sec: 0, end_sec: 8, text: "测试歌词", safe_area: "caption_bottom" }],
  });
  await writeJson(projectPath, "data/storyboard/visual_plan.json", {
    visuals: [{ scene_id: "scene_001", elements: ["beat_accent"] }],
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
