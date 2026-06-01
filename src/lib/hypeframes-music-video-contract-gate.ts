import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { writeQaReport } from "./gate-report.ts";

const requiredFiles = [
  "hypeframes/generated/agent_context.json",
  "hypeframes/src/index.html",
  "hypeframes/src/styles.css",
  "hypeframes/src/main.js",
  "hypeframes/src/config.json",
  "audio/music_manifest.json",
  "audio/master/minimax_rap_master.wav",
  "hypeframes/public_assets/audio/minimax_rap_master.wav",
  "data/timing/section_map.json",
  "data/storyboard/caption_plan.json",
];

export async function runHypeframesMusicVideoContractGate(projectPath: string): Promise<void> {
  const blockingIssues: string[] = [];
  const warnings: string[] = [];

  for (const relativePath of requiredFiles) {
    const file = await fileInfo(path.join(projectPath, relativePath));
    if (!file.exists) blockingIssues.push(`Missing music video contract file: ${relativePath}`);
    if (file.exists && file.sizeBytes === 0) blockingIssues.push(`Music video contract file is empty: ${relativePath}`);
  }

  const context = await readOptionalJson<Record<string, unknown>>(projectPath, "hypeframes/generated/agent_context.json");
  const config = await readOptionalJson<Record<string, unknown>>(projectPath, "hypeframes/src/config.json");
  const manifest = await readOptionalJson<Record<string, unknown>>(projectPath, "audio/music_manifest.json");
  const mainJs = await readOptionalText(projectPath, "hypeframes/src/main.js");
  const indexHtml = await readOptionalText(projectPath, "hypeframes/src/index.html");
  const styles = await readOptionalText(projectPath, "hypeframes/src/styles.css");

  if (context?.schema_version !== "qivance.hypeframes.agent_context.v1") {
    blockingIssues.push("hypeframes/generated/agent_context.json has an invalid schema_version.");
  }

  const configDuration = numberValue(config?.duration_sec);
  const manifestDuration = numberValue(manifest?.duration_sec);
  if (configDuration !== null && manifestDuration !== null && Math.abs(configDuration - manifestDuration) > 0.5) {
    blockingIssues.push("hypeframes/src/config.json duration_sec does not match audio/music_manifest.json duration_sec.");
  }

  const audioPath = stringValue(config?.audio_path);
  if (audioPath !== "public_assets/audio/minimax_rap_master.wav") {
    blockingIssues.push("hypeframes/src/config.json audio_path must use public_assets/audio/minimax_rap_master.wav.");
  }

  if (!mainJs.includes("window.__timelines")) {
    blockingIssues.push("hypeframes/src/main.js must expose window.__timelines.");
  }

  for (const [relativePath, text] of [
    ["hypeframes/src/index.html", indexHtml],
    ["hypeframes/src/styles.css", styles],
    ["hypeframes/src/main.js", mainJs],
  ] as const) {
    if (/https?:\/\//i.test(text)) {
      blockingIssues.push(`${relativePath} contains an external URL.`);
    }
    if (/\bDate\.now\s*\(/.test(text)) {
      blockingIssues.push(`${relativePath} uses Date.now, which is not deterministic.`);
    }
    if (/\bMath\.random\s*\(/.test(text)) {
      blockingIssues.push(`${relativePath} uses Math.random, which is not deterministic.`);
    }
    if (/\bfetch\s*\(/.test(text)) {
      blockingIssues.push(`${relativePath} uses network fetch.`);
    }
  }

  if (!indexHtml.includes("public_assets/audio/minimax_rap_master.wav") && !mainJs.includes("public_assets/audio/minimax_rap_master.wav")) {
    warnings.push("HypeFrames source does not reference local audio directly; render pipeline must mux locked master audio.");
  }

  await writeQaReport(projectPath, "qa/hypeframes/hypeframes_music_video_contract_qa_report.json", {
    gate_name: "HypeFrames Music Video Contract QA",
    status: blockingIssues.length > 0 ? "rule_fail_blocked" : warnings.length > 0 ? "rule_pass_with_warnings" : "rule_pass",
    blocking_issues: dedupe(blockingIssues),
    warnings: dedupe(warnings),
    input_artifacts: requiredFiles,
    output_artifacts: ["qa/hypeframes/hypeframes_music_video_contract_qa_report.json"],
  });
}

async function fileInfo(filePath: string): Promise<{ exists: boolean; sizeBytes: number }> {
  try {
    const fileStat = await stat(filePath);
    return { exists: fileStat.isFile(), sizeBytes: fileStat.size };
  } catch {
    return { exists: false, sizeBytes: 0 };
  }
}

async function readOptionalJson<T>(projectPath: string, relativePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(projectPath, relativePath), "utf8")) as T;
  } catch {
    return null;
  }
}

async function readOptionalText(projectPath: string, relativePath: string): Promise<string> {
  try {
    return await readFile(path.join(projectPath, relativePath), "utf8");
  } catch {
    return "";
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
