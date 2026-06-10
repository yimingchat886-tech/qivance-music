import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveMediaE2EPythonEnv } from "../src/lib/media-e2e/python-env.ts";

test("resolves fixed media E2E Python env from explicit environment", () => {
  const env = resolveMediaE2EPythonEnv({
    cwd: "/repo",
    env: {
      QIVANCE_MEDIA_E2E_PYTHON: "/repo/.venv/bin/python",
      QIVANCE_WHISPERX_DEVICE: "cuda",
      QIVANCE_WHISPERX_MODEL: "large-v3",
      QIVANCE_WHISPERX_CACHE_DIR: "/repo/.cache/whisperx",
    },
  });

  assert.equal(env.pythonExecutable, "/repo/.venv/bin/python");
  assert.equal(env.requirementsPath, "/repo/requirements/media-e2e-python.txt");
  assert.equal(env.whisperx.device, "cuda");
  assert.equal(env.whisperx.model, "large-v3");
  assert.equal(env.whisperx.cacheDir, "/repo/.cache/whisperx");
  assert.equal(env.whisperx.requireGpu, true);
});

test("defaults media E2E Python env to repo-local .venv and cache", () => {
  const env = resolveMediaE2EPythonEnv({ cwd: "/repo", env: {} });

  assert.equal(env.pythonExecutable, path.join("/repo", ".venv", "bin", "python"));
  assert.equal(env.whisperx.device, "cuda");
  assert.equal(env.whisperx.model, "large-v3");
  assert.equal(env.whisperx.cacheDir.endsWith(path.join(".cache", "huggingface")), true);
  assert.equal(env.whisperx.requireGpu, true);
});

