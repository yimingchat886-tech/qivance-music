import os from "node:os";
import path from "node:path";

export type MediaE2EPythonEnv = {
  pythonExecutable: string;
  requirementsPath: string;
  whisperx: {
    device: "cuda" | "cpu";
    model: string;
    cacheDir: string;
    requireGpu: boolean;
  };
};

export function resolveMediaE2EPythonEnv(input: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}): MediaE2EPythonEnv {
  const cwd = input.cwd ?? process.cwd();
  const env = input.env ?? process.env;
  const device = env.QIVANCE_WHISPERX_DEVICE === "cpu" ? "cpu" : "cuda";

  return {
    pythonExecutable: env.QIVANCE_MEDIA_E2E_PYTHON ?? path.join(cwd, ".venv", "bin", "python"),
    requirementsPath: path.join(cwd, "requirements", "media-e2e-python.txt"),
    whisperx: {
      device,
      model: env.QIVANCE_WHISPERX_MODEL ?? "large-v3",
      cacheDir: env.QIVANCE_WHISPERX_CACHE_DIR ?? env.HF_HOME ?? path.join(os.homedir(), ".cache", "huggingface"),
      requireGpu: env.QIVANCE_WHISPERX_REQUIRE_GPU === "0" ? false : device === "cuda",
    },
  };
}

