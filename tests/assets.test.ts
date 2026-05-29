import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { saveAudioAsset } from "../src/lib/audio-db.ts";
import { importAcceptedMusicProject } from "../src/lib/import-project.ts";

test("imports a minimal accepted MiniMax project into the standard asset directory", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "qivance-assets-"));
  const savedAudio = await saveAudioAsset(tempRoot, {
    filename: "raw.mp3",
    mimeType: "audio/mpeg",
    data: Buffer.from("fake-audio-for-hash"),
  });

  const project = await importAcceptedMusicProject({
    storageRoot: tempRoot,
    topic: "为什么星星会发光",
    targetDuration: 60,
    mainComposition: "science-main",
    videoSize: "1920x1080",
    lyricsMarkdown: "[Verse]\n恒星核心在聚变",
    audioAssetId: savedAudio.id,
  });

  assert.equal(project.workflowState, "music_locking");
  assert.match(project.projectId, /^project_/);

  await stat(path.join(project.projectPath, "input", "project_brief.md"));
  await stat(path.join(project.projectPath, "data", "lyrics", "lyrics.md"));
  await stat(path.join(project.projectPath, "data", "lyrics", "lyrics_structured.json"));
  await stat(path.join(project.projectPath, "audio", "raw", "minimax_rap_raw.mp3"));
  await stat(path.join(project.projectPath, "audio", "minimax_request_manifest.json"));
  await stat(path.join(project.projectPath, "versions", "v003_music_generated_manifest.json"));
  await stat(path.join(project.projectPath, "project_manifest.json"));
  await stat(path.join(project.projectPath, "asset_manifest.json"));
  await stat(path.join(project.projectPath, "workflow_snapshot.json"));

  const workflowSnapshot = JSON.parse(
    await readFile(path.join(project.projectPath, "workflow_snapshot.json"), "utf8"),
  );
  const manifest = JSON.parse(await readFile(path.join(project.projectPath, "project_manifest.json"), "utf8"));
  const assetManifest = JSON.parse(await readFile(path.join(project.projectPath, "asset_manifest.json"), "utf8"));

  assert.equal(workflowSnapshot.workflow_state, "music_locking");
  assert.deepEqual(workflowSnapshot.next_allowed_actions, ["run_post_music_workflow"]);
  assert.equal(manifest.audio_asset_id, savedAudio.id);
  assert.equal(manifest.main_composition, "science-main");
  assert.equal(manifest.video_size, "1920x1080");
  assert.equal(manifest.video_width, 1920);
  assert.equal(manifest.video_height, 1080);
  assert.equal(assetManifest.current_assets.some((asset: { type: string }) => asset.type === "input_config"), false);
  await assert.rejects(stat(path.join(project.projectPath, "input", "input_config.json")), /ENOENT/);
});
