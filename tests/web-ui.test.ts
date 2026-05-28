import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { importAcceptedMusicProject } from "../src/lib/import-project.ts";
import { loadProjectSummary, renderProjectWorkspace } from "../src/lib/web-ui.ts";

test("workspace UI exposes only post-MiniMax preview actions for the first MVP", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "qivance-web-"));
  const sourceAudio = path.join(tempRoot, "raw.mp3");
  await writeFile(sourceAudio, Buffer.from("fake-audio-for-ui"));
  const imported = await importAcceptedMusicProject({
    storageRoot: path.join(tempRoot, "projects"),
    inputConfig: {
      topic: "光合作用为什么重要",
      target_duration: 60,
      aspect_ratio: "9:16",
    },
    lyricsMarkdown: "[Verse]\n叶绿体接住阳光",
    rawAudioPath: sourceAudio,
  });

  const summary = await loadProjectSummary(imported.projectPath);
  const html = renderProjectWorkspace(summary);

  assert.match(html, /生成 Preview 工作流/);
  assert.match(html, /music_accepted/);
  assert.doesNotMatch(html, /MiniMax Music 生成/);
  assert.doesNotMatch(html, /生成歌词/);
  assert.doesNotMatch(html, /积分扣费/);
});

