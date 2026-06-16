import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runWhisperXAlignmentWithDeps, type WhisperXRunnerDeps } from "../src/lib/word-alignment/whisperx-runner.ts";

test("runs WhisperX alignment script and records env metadata", async () => {
  const root = path.join(tmpdir(), `qivance-whisperx-runner-${Date.now()}`);
  const audioPath = path.join(root, "active_music_take.mp3");
  const lyricsPath = path.join(root, "lyrics.md");
  const wordTimingPath = path.join(root, "lyric_word_timing.json");
  const reportPath = path.join(root, "alignment_report.json");
  await mkdir(root, { recursive: true });
  await writeFile(audioPath, "mp3");
  await writeFile(lyricsPath, "hello world");

  const calls: Array<{ file: string; args: string[]; env?: NodeJS.ProcessEnv }> = [];
  const deps: WhisperXRunnerDeps = {
    execFile: async (file, args, options) => {
      calls.push({ file, args, env: options?.env });
      await writeFile(wordTimingPath, JSON.stringify({
        schema_version: 1,
        backend: "whisperx",
        duration_sec: 2,
        words: [
          { word_id: "w_000001", text: "hello", paragraph_id: "p_001", start_sec: 0, end_sec: 1, confidence: 0.98, source: "whisperx" },
        ],
      }));
      await writeFile(reportPath, JSON.stringify({
        schema_version: 1,
        backend: "whisperx",
        status: "passed",
        env: { python_version: "3.12.3", whisperx_version: "unknown", librosa_version: "0.11.0" },
        model: { name: "large-v3", device: "cuda", cache_dir: "/cache" },
        metrics: { total_words: 1, aligned_words: 1, low_confidence_words: 0, unmatched_words: 0 },
      }));
      return { stdout: "aligned", stderr: "" };
    },
  };

  const result = await runWhisperXAlignmentWithDeps({
    pythonExecutable: "/repo/.venv/bin/python",
    scriptPath: "/repo/scripts/python/align-lyrics-whisperx.py",
    audioPath,
    lyricsPath,
    wordTimingPath,
    reportPath,
    language: "zh",
    device: "cuda",
    model: "large-v3",
    cacheDir: "/cache",
    requireGpu: true,
  }, deps);

  assert.equal(calls[0]?.file, "/repo/.venv/bin/python");
  assert.deepEqual(calls[0]?.args, [
    "/repo/scripts/python/align-lyrics-whisperx.py",
    "--audio", audioPath,
    "--lyrics", lyricsPath,
    "--word-timing-out", wordTimingPath,
    "--report-out", reportPath,
    "--language", "zh",
    "--device", "cuda",
    "--model", "large-v3",
    "--cache-dir", "/cache",
    "--require-gpu",
  ]);
  assert.equal(calls[0]?.env?.HF_HOME, "/cache");
  assert.equal(result.wordTiming.backend, "whisperx");
  assert.equal(result.alignmentReport.model.device, "cuda");
});

test("fails fast when WhisperX runner does not produce required files", async () => {
  const root = path.join(tmpdir(), `qivance-whisperx-missing-${Date.now()}`);
  await mkdir(root, { recursive: true });

  await assert.rejects(
    () => runWhisperXAlignmentWithDeps({
      pythonExecutable: "/repo/.venv/bin/python",
      scriptPath: "/repo/scripts/python/align-lyrics-whisperx.py",
      audioPath: path.join(root, "active_music_take.mp3"),
      lyricsPath: path.join(root, "lyrics.md"),
      wordTimingPath: path.join(root, "lyric_word_timing.json"),
      reportPath: path.join(root, "alignment_report.json"),
      language: "zh",
      device: "cuda",
      model: "large-v3",
      cacheDir: "/cache",
      requireGpu: true,
    }, { execFile: async () => ({ stdout: "", stderr: "" }) }),
    /WhisperX runner did not write/,
  );
});



test("fails fast when WhisperX runner exceeds timeout", async () => {
  const root = path.join(tmpdir(), "qivance-whisperx-timeout-" + Date.now());
  await mkdir(root, { recursive: true });

  await assert.rejects(
    () => runWhisperXAlignmentWithDeps({
      pythonExecutable: "/repo/.venv/bin/python",
      scriptPath: "/repo/scripts/python/align-lyrics-whisperx.py",
      audioPath: path.join(root, "active_music_take.mp3"),
      lyricsPath: path.join(root, "lyrics.md"),
      wordTimingPath: path.join(root, "lyric_word_timing.json"),
      reportPath: path.join(root, "alignment_report.json"),
      language: "zh",
      device: "cuda",
      model: "large-v3",
      cacheDir: "/cache",
      requireGpu: true,
      timeoutMs: 1,
    }, { execFile: async () => await new Promise(() => undefined) }),
    /timed out/,
  );
});
