import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { buildCodexFrameAgentPrompt } from "../src/lib/video-html/codex-frame-agent-prompt.ts";
import { assertAllowedPathChanges, diffSnapshots, snapshotFiles } from "../src/lib/video-html/path-gate.ts";

test("Codex frame prompt includes strict duration and forbidden edit instructions", () => {
  const prompt = buildCodexFrameAgentPrompt({
    smallProjectId: "sp_demo_001",
    agentContextPath: "codex/agent_context.json",
    contentGraphPath: "content-graph.json",
    frameContractsPath: "qivance-frame-contracts.json",
  });

  assert.match(prompt, /Qivance html-video frame author/);
  assert.match(prompt, /You do not generate music/);
  assert.match(prompt, /durationPolicy=strict/);
  assert.match(prompt, /allowedHtmlPath/);
  assert.match(prompt, /must exist on disk/);
  assert.match(prompt, /Do not only describe the HTML/);
  assert.match(prompt, /JSON\.parse succeeds/);
  assert.match(prompt, /window\.__QIVANCE_FRAME = \{"graphNodeId":"scene_id"/);
  assert.match(prompt, /sourceVideo\.enabled=true/);
  assert.match(prompt, /exact sourceVideo\.path/);
  assert.match(prompt, /print DONE, and exit/);
  assert.match(prompt, /do not change content-graph\.json/i);
  assert.match(prompt, /No network assets/);
});

test("path gate allows frames, codex, and qa changes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "qivance-path-gate-ok-"));
  await mkdir(path.join(dir, "frames"), { recursive: true });
  const before = await snapshotFiles(dir);
  await writeFile(path.join(dir, "frames", "01-scene.html"), "<!doctype html>", "utf8");
  await mkdir(path.join(dir, "codex"), { recursive: true });
  await writeFile(path.join(dir, "codex", "result.jsonl"), "{}", "utf8");
  const changed = diffSnapshots(before, await snapshotFiles(dir));

  assert.deepEqual(changed.sort(), ["codex/result.jsonl", "frames/01-scene.html"]);
  assert.doesNotThrow(() => assertAllowedPathChanges(changed));
});

test("path gate rejects content graph edits", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "qivance-path-gate-block-"));
  await writeFile(path.join(dir, "content-graph.json"), "before", "utf8");
  const before = await snapshotFiles(dir);
  await writeFile(path.join(dir, "content-graph.json"), "after", "utf8");
  const changed = diffSnapshots(before, await snapshotFiles(dir));

  assert.throws(
    () => assertAllowedPathChanges(changed),
    (error) => {
      assert.equal((error as { code?: string }).code, "codex-forbidden-file-change");
      assert.deepEqual((error as { changedFiles?: string[] }).changedFiles, ["content-graph.json"]);
      return true;
    },
  );
  assert.equal(await readFile(path.join(dir, "content-graph.json"), "utf8"), "after");
});
