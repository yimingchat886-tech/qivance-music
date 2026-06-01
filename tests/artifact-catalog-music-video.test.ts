import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadArtifactCatalog } from "../src/lib/artifact-catalog.ts";

test("artifact catalog includes music-video agent context and contract QA artifacts", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-artifacts-music-video-"));

  const groups = await loadArtifactCatalog(projectPath);
  const hypeframes = groups.find((group) => group.id === "hypeframes_project");

  assert.ok(hypeframes?.artifacts.some((artifact) => artifact.relativePath === "hypeframes/generated/agent_context.json"));
  assert.ok(hypeframes?.artifacts.some((artifact) => artifact.relativePath === "qa/hypeframes/hypeframes_agent_context_qa_report.json"));
  assert.ok(hypeframes?.artifacts.some((artifact) => artifact.relativePath === "qa/hypeframes/hypeframes_music_video_contract_qa_report.json"));
});
