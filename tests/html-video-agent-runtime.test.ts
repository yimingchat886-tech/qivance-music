import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  runHtmlVideoAgentRuntimeWithDeps,
  type HtmlVideoRuntimeDeps,
} from "../src/lib/video-html/html-video-agent-runtime.ts";

test("runs html-video agent runtime through injected deps", async () => {
  const root = path.join(tmpdir(), `qivance-html-video-runtime-${Date.now()}`);
  const promptPath = path.join(root, "prompt.md");
  await mkdir(root, { recursive: true });
  await writeFile(promptPath, "Write frames", "utf8");
  const events: string[] = [];
  const deps: HtmlVideoRuntimeDeps = {
    findAgent: (id) => ({ id, name: "Test Agent" }),
    spawnAgent: ({ prompt, context, onEvent }) => {
      events.push(prompt);
      events.push(context.cwd);
      onEvent?.({ type: "text", chunk: "ok" });
      return {
        pid: 0,
        stop: () => undefined,
        done: Promise.resolve({ exitCode: 0, signal: null }),
      };
    },
  };

  const result = await runHtmlVideoAgentRuntimeWithDeps({
    projectDir: root,
    promptPath,
    agentId: "codex",
  }, deps);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "ok");
  assert.deepEqual(events, ["Write frames", root]);
});

test("times out html-video agent runtime", async () => {
  const root = path.join(tmpdir(), `qivance-html-video-runtime-timeout-${Date.now()}`);
  const promptPath = path.join(root, "prompt.md");
  await mkdir(root, { recursive: true });
  await writeFile(promptPath, "Write frames", "utf8");
  let stopped = false;
  const deps: HtmlVideoRuntimeDeps = {
    findAgent: (id) => ({ id, name: "Test Agent" }),
    spawnAgent: () => ({
      pid: 0,
      stop: () => {
        stopped = true;
      },
      done: new Promise(() => undefined),
    }),
  };

  const result = await runHtmlVideoAgentRuntimeWithDeps({
    projectDir: root,
    promptPath,
    timeoutMs: 10,
  }, deps);

  assert.equal(result.exitCode, 124);
  assert.equal(result.timedOut, true);
  assert.equal(stopped, true);
  assert.match(result.stderr, /timed out/);
});
