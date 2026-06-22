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
      cacheDir: env.QIVANCE_WHISPERX_CACHE_DIR ?? env.HF_HOME ?? path.join(cwd, ".cache", "huggingface"),
      requireGpu: env.QIVANCE_WHISPERX_REQUIRE_GPU === "0" ? false : device === "cuda",
    },
  };
}

export type WhisperXPreflightResult = {
  ok: boolean;
  mode: "full" | "diagnostic";
  issues: string[];
  diagnostics: string[];
};

export function validateWhisperXPreflight(input: {
  pythonEnv: MediaE2EPythonEnv;
  allowCpuDiagnostic?: boolean;
  requireGpu?: boolean;
}): WhisperXPreflightResult {
  const issues: string[] = [];
  const diagnostics: string[] = [];
  const requireGpu = input.requireGpu ?? input.pythonEnv.whisperx.requireGpu;

  if (input.pythonEnv.whisperx.device === "cpu") {
    diagnostics.push("WhisperX is configured for CPU; this is diagnostic-only for V2 media E2E.");
    if (!input.allowCpuDiagnostic) {
      issues.push("WhisperX CPU mode is diagnostic-only; set an explicit diagnostic allow flag or configure QIVANCE_WHISPERX_DEVICE=cuda for full E2E.");
    }
  }

  if (requireGpu && input.pythonEnv.whisperx.device !== "cuda") {
    issues.push("WhisperX full E2E requires CUDA/GPU configuration.");
  }

  return {
    ok: issues.length === 0,
    mode: input.pythonEnv.whisperx.device === "cpu" ? "diagnostic" : "full",
    issues,
    diagnostics,
  };
}
