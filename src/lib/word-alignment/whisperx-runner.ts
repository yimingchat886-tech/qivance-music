import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCallback);

export type LyricWordTimingArtifact = {
  schema_version: 1;
  backend: "whisperx";
  duration_sec: number;
  words: Array<{
    word_id: string;
    text: string;
    paragraph_id: string;
    start_sec: number;
    end_sec: number;
    confidence: number;
    source: string;
  }>;
};

export type AlignmentReportArtifact = {
  schema_version: 1;
  backend: "whisperx";
  status: "passed" | "failed";
  env: Record<string, unknown>;
  model: {
    name: string;
    device: string;
    cache_dir: string;
    [key: string]: unknown;
  };
  metrics: {
    total_words: number;
    aligned_words: number;
    low_confidence_words: number;
    unmatched_words: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type WhisperXRunnerInput = {
  pythonExecutable: string;
  scriptPath: string;
  audioPath: string;
  lyricsPath: string;
  wordTimingPath: string;
  reportPath: string;
  language: string;
  device: "cuda" | "cpu";
  model: string;
  cacheDir: string;
  requireGpu: boolean;
  timeoutMs?: number;
};

export type WhisperXRunnerResult = {
  stdout: string;
  stderr: string;
  wordTiming: LyricWordTimingArtifact;
  alignmentReport: AlignmentReportArtifact;
};

export type WhisperXRunnerDeps = {
  execFile(
    file: string,
    args: string[],
    options?: { env?: NodeJS.ProcessEnv },
  ): Promise<{ stdout: string; stderr: string }>;
};

export async function runWhisperXAlignment(input: WhisperXRunnerInput): Promise<WhisperXRunnerResult> {
  const controller = new AbortController();
  const timer = input.timeoutMs
    ? setTimeout(() => controller.abort(), input.timeoutMs)
    : undefined;
  try {
    return await runWhisperXAlignmentWithDeps(input, {
      execFile: async (file, args, options) => {
        try {
          const result = await execFileAsync(file, args, { ...options, signal: controller.signal });
          return { stdout: String(result.stdout), stderr: String(result.stderr) };
        } catch (error) {
          if ((error as Error).name === "AbortError") {
            throw new Error("WhisperX runner timed out after " + input.timeoutMs + "ms");
          }
          throw error;
        }
      },
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runWhisperXAlignmentWithDeps(
  input: WhisperXRunnerInput,
  deps: WhisperXRunnerDeps,
): Promise<WhisperXRunnerResult> {
  const args = [
    input.scriptPath,
    "--audio",
    input.audioPath,
    "--lyrics",
    input.lyricsPath,
    "--word-timing-out",
    input.wordTimingPath,
    "--report-out",
    input.reportPath,
    "--language",
    input.language,
    "--device",
    input.device,
    "--model",
    input.model,
    "--cache-dir",
    input.cacheDir,
    ...(input.requireGpu ? ["--require-gpu"] : []),
  ];

  const { stdout, stderr } = await withTimeout(
    deps.execFile(input.pythonExecutable, args, {
      env: {
        ...process.env,
        HF_HOME: input.cacheDir,
        NUMBA_CACHE_DIR: process.env.NUMBA_CACHE_DIR ?? defaultTmpCacheDir("qivance-numba-cache"),
        TORCH_HOME: process.env.TORCH_HOME ?? defaultTmpCacheDir("qivance-torch-cache"),
        XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? defaultTmpCacheDir("qivance-xdg-cache"),
        QIVANCE_WHISPERX_MODEL: input.model,
        QIVANCE_WHISPERX_DEVICE: input.device,
      },
    }),
    input.timeoutMs,
  );

  const wordTiming = await readJson<LyricWordTimingArtifact>(
    input.wordTimingPath,
    "WhisperX runner did not write lyric_word_timing.json",
  );
  const alignmentReport = await readJson<AlignmentReportArtifact>(
    input.reportPath,
    "WhisperX runner did not write alignment_report.json",
  );

  if (wordTiming.backend !== "whisperx") {
    throw new Error("WhisperX runner wrote lyric_word_timing.json with non-whisperx backend");
  }
  if (alignmentReport.backend !== "whisperx") {
    throw new Error("WhisperX runner wrote alignment_report.json with non-whisperx backend");
  }

  return { stdout, stderr, wordTiming, alignmentReport };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (!timeoutMs) return await promise;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("WhisperX runner timed out after " + timeoutMs + "ms")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readJson<T>(filePath: string, missingMessage: string): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${missingMessage}: ${filePath}`);
    }
    throw error;
  }
}

function defaultTmpCacheDir(name: string): string {
  return `${process.env.TMPDIR ?? "/tmp"}/${name}`;
}
