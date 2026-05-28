import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { importAcceptedMusicProject } from "../src/lib/import-project.ts";

test("imports a minimal accepted MiniMax project into the standard asset directory", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "qivance-assets-"));
  const sourceAudio = path.join(tempRoot, "raw.mp3");
  await writeFile(sourceAudio, Buffer.from("fake-audio-for-hash"));

  const project = await importAcceptedMusicProject({
    storageRoot: path.join(tempRoot, "projects"),
    inputConfig: {
      topic: "为什么星星会发光",
      target_duration: 60,
      audience: "泛科普用户",
      tone: "热血",
      rap_style: "boom bap",
      aspect_ratio: "9:16",
      platform: "douyin",
      budget_limit: 0,
      auto_continue: false,
      auto_approve_music: true,
      auto_approve_preview: false,
    },
    lyricsMarkdown: "[Verse]\n恒星核心在聚变",
    rawAudioPath: sourceAudio,
  });

  assert.equal(project.workflowState, "music_accepted");
  assert.match(project.projectId, /^project_/);

  await stat(path.join(project.projectPath, "input", "input_config.json"));
  await stat(path.join(project.projectPath, "input", "project_brief.md"));
  await stat(path.join(project.projectPath, "data", "lyrics.md"));
  await stat(path.join(project.projectPath, "data", "lyrics_structured.json"));
  await stat(path.join(project.projectPath, "data", "selected_music_prompt.json"));
  await stat(path.join(project.projectPath, "audio", "minimax_rap_raw.mp3"));
  await stat(path.join(project.projectPath, "project_manifest.json"));
  await stat(path.join(project.projectPath, "asset_manifest.json"));
  await stat(path.join(project.projectPath, "workflow_snapshot.json"));

  const workflowSnapshot = JSON.parse(
    await readFile(path.join(project.projectPath, "workflow_snapshot.json"), "utf8"),
  );
  assert.equal(workflowSnapshot.workflow_state, "music_accepted");
});

