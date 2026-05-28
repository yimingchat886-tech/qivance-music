import { copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureDir, sha256File, writeJson } from "./fs-utils.ts";
import { parseLyrics, type StructuredLyrics } from "./lyrics.ts";
import type { WorkflowState } from "./workflow.ts";

export type InputConfig = {
  topic: string;
  target_duration: number;
  audience?: string;
  tone?: string;
  rap_style?: string;
  aspect_ratio?: string;
  platform?: string;
  budget_limit?: number;
  auto_continue?: boolean;
  auto_approve_music?: boolean;
  auto_approve_preview?: boolean;
};

export type ImportAcceptedMusicProjectInput = {
  storageRoot: string;
  inputConfig: InputConfig;
  lyricsMarkdown: string;
  rawAudioPath: string;
  lyricsStructured?: StructuredLyrics;
  selectedMusicPrompt?: Record<string, unknown>;
  projectBriefMarkdown?: string;
};

export type ImportedProject = {
  projectId: string;
  projectPath: string;
  workflowState: WorkflowState;
};

const projectDirs = [
  "input/source_materials",
  "data/facts",
  "data/lyrics",
  "data/timing",
  "data/storyboard",
  "audio/raw",
  "audio/master",
  "audio/analysis",
  "hypeframes/compositions",
  "hypeframes/public_assets/audio",
  "hypeframes/render_targets",
  "hypeframes/src",
  "hypeframes/generated",
  "qa/music",
  "qa/timing",
  "qa/storyboard",
  "qa/hypeframes",
  "qa/render/keyframes",
  "dist/preview",
  "dist/review",
  "dist/final",
  "logs",
  "versions",
  "archive",
];

export async function importAcceptedMusicProject(
  input: ImportAcceptedMusicProjectInput,
): Promise<ImportedProject> {
  const projectId = `project_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const projectPath = path.join(input.storageRoot, projectId);
  const workflowState: WorkflowState = "music_locking";

  await ensureDir(projectPath);
  await Promise.all(projectDirs.map((dir) => ensureDir(path.join(projectPath, dir))));

  const rawExtension = path.extname(input.rawAudioPath).toLowerCase() || ".mp3";
  const rawAudioFile = `minimax_rap_raw${rawExtension}`;
  const rawAudioDestination = path.join(projectPath, "audio", "raw", rawAudioFile);
  await copyFile(input.rawAudioPath, rawAudioDestination);

  const lyricsStructured = input.lyricsStructured ?? parseLyrics(input.lyricsMarkdown);
  const selectedMusicPrompt =
    input.selectedMusicPrompt ?? {
      source: "external_minimax",
      prompt: "",
      notes: "MiniMax Music generation happened outside this MVP.",
    };

  await writeJson(path.join(projectPath, "input", "input_config.json"), input.inputConfig);
  await writeFile(
    path.join(projectPath, "input", "project_brief.md"),
    input.projectBriefMarkdown ?? renderProjectBrief(input.inputConfig),
    "utf8",
  );
  await writeFile(path.join(projectPath, "data", "lyrics", "lyrics.md"), input.lyricsMarkdown, "utf8");
  await writeJson(path.join(projectPath, "data", "lyrics", "lyrics_structured.json"), lyricsStructured);
  await writeJson(path.join(projectPath, "audio", "minimax_request_manifest.json"), {
    provider: "external_minimax",
    prompt: selectedMusicPrompt,
    lyrics_path: "data/lyrics/lyrics.md",
    raw_audio_path: `audio/raw/${rawAudioFile}`,
    created_at: new Date().toISOString(),
  });

  const rawAudioHash = await sha256File(rawAudioDestination);
  const now = new Date().toISOString();

  await writeJson(path.join(projectPath, "project_manifest.json"), {
    project_id: projectId,
    workspace_id: "local",
    created_by_type: "human",
    topic: input.inputConfig.topic,
    target_duration: input.inputConfig.target_duration,
    actual_audio_duration: null,
    aspect_ratio: input.inputConfig.aspect_ratio ?? "9:16",
    current_workflow_state: workflowState,
    locked_audio_hash: null,
    preview_video_hash: null,
    created_at: now,
    updated_at: now,
  });

  await writeJson(path.join(projectPath, "asset_manifest.json"), {
    project_id: projectId,
    current_assets: [
      {
        type: "input_config",
        path: "input/input_config.json",
      },
      {
        type: "lyrics",
        path: "data/lyrics/lyrics.md",
      },
      {
        type: "lyrics_structured",
        path: "data/lyrics/lyrics_structured.json",
      },
      {
        type: "raw_audio",
        path: `audio/raw/${rawAudioFile}`,
        hash: rawAudioHash,
      },
    ],
    updated_at: now,
  });

  await writeJson(path.join(projectPath, "workflow_snapshot.json"), {
    project_id: projectId,
    workflow_state: workflowState,
    next_allowed_actions: ["run_post_music_workflow"],
    updated_at: now,
  });

  await writeJson(path.join(projectPath, "versions", "v003_music_generated_manifest.json"), {
    project_id: projectId,
    workflow_state: workflowState,
    input_artifacts: [
      "input/input_config.json",
      "input/project_brief.md",
      "data/lyrics/lyrics.md",
      "data/lyrics/lyrics_structured.json",
      "audio/minimax_request_manifest.json",
      `audio/raw/${rawAudioFile}`,
    ],
    raw_audio_hash: rawAudioHash,
    created_at: now,
  });

  await writeFile(
    path.join(projectPath, "logs", "step_runs.jsonl"),
    `${JSON.stringify({
      event: "import_accepted_music_project",
      status: "succeeded",
      workflow_state: workflowState,
      created_at: now,
    })}\n`,
    "utf8",
  );

  return { projectId, projectPath, workflowState };
}

function renderProjectBrief(inputConfig: InputConfig): string {
  return [
    `# ${inputConfig.topic}`,
    "",
    `- Target duration: ${inputConfig.target_duration}s`,
    `- Audience: ${inputConfig.audience ?? "unspecified"}`,
    `- Tone: ${inputConfig.tone ?? "unspecified"}`,
    `- Rap style: ${inputConfig.rap_style ?? "unspecified"}`,
    `- Aspect ratio: ${inputConfig.aspect_ratio ?? "9:16"}`,
    `- Platform: ${inputConfig.platform ?? "unspecified"}`,
    "",
  ].join("\n");
}
