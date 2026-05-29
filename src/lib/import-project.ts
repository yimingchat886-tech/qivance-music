import { copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { materializeAudioAsset } from "./audio-db.ts";
import { ensureDir, sha256File, writeJson } from "./fs-utils.ts";
import { parseLyrics, type StructuredLyrics } from "./lyrics.ts";
import { resolveMainComposition, resolveVideoSize } from "./render-settings.ts";
import type { WorkflowState } from "./workflow.ts";

export type ImportAcceptedMusicProjectInput = {
  storageRoot: string;
  topic: string;
  targetDuration?: number;
  lyricsMarkdown: string;
  rawAudioPath?: string;
  audioAssetId?: string;
  mainComposition?: string;
  videoSize?: string;
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

  const rawAudio = await writeRawAudio(input, projectPath);
  const videoSize = resolveVideoSize(input.videoSize);
  const mainComposition = resolveMainComposition(input.mainComposition);
  const targetDuration = input.targetDuration ?? 60;

  const lyricsStructured = input.lyricsStructured ?? parseLyrics(input.lyricsMarkdown);
  const selectedMusicPrompt =
    input.selectedMusicPrompt ?? {
      source: "external_minimax",
      prompt: "",
      notes: "MiniMax Music generation happened outside this MVP.",
    };

  await writeFile(
    path.join(projectPath, "input", "project_brief.md"),
    input.projectBriefMarkdown ?? renderProjectBrief({
      topic: input.topic,
      targetDuration,
      mainComposition,
      videoSize: videoSize.id,
    }),
    "utf8",
  );
  await writeFile(path.join(projectPath, "data", "lyrics", "lyrics.md"), input.lyricsMarkdown, "utf8");
  await writeJson(path.join(projectPath, "data", "lyrics", "lyrics_structured.json"), lyricsStructured);
  await writeJson(path.join(projectPath, "audio", "minimax_request_manifest.json"), {
    provider: "external_minimax",
    prompt: selectedMusicPrompt,
    lyrics_path: "data/lyrics/lyrics.md",
    audio_asset_id: input.audioAssetId ?? null,
    raw_audio_path: `audio/raw/${rawAudio.filename}`,
    created_at: new Date().toISOString(),
  });

  const rawAudioHash = await sha256File(rawAudio.path);
  const now = new Date().toISOString();

  await writeJson(path.join(projectPath, "project_manifest.json"), {
    project_id: projectId,
    workspace_id: "local",
    created_by_type: "human",
    topic: input.topic,
    target_duration: targetDuration,
    actual_audio_duration: null,
    aspect_ratio: videoSize.aspectRatio,
    audio_asset_id: input.audioAssetId ?? null,
    main_composition: mainComposition,
    video_size: videoSize.id,
    video_width: videoSize.width,
    video_height: videoSize.height,
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
        type: "lyrics",
        path: "data/lyrics/lyrics.md",
      },
      {
        type: "lyrics_structured",
        path: "data/lyrics/lyrics_structured.json",
      },
      {
        type: "raw_audio",
        path: `audio/raw/${rawAudio.filename}`,
        hash: rawAudioHash,
        audio_asset_id: input.audioAssetId ?? null,
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
      "input/project_brief.md",
      "data/lyrics/lyrics.md",
      "data/lyrics/lyrics_structured.json",
      "audio/minimax_request_manifest.json",
      `audio/raw/${rawAudio.filename}`,
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

async function writeRawAudio(
  input: ImportAcceptedMusicProjectInput,
  projectPath: string,
): Promise<{ filename: string; path: string }> {
  const rawAudioDir = path.join(projectPath, "audio", "raw");
  if (input.audioAssetId) {
    const materialized = await materializeAudioAsset(input.storageRoot, input.audioAssetId, rawAudioDir, "minimax_rap_raw");
    return { filename: materialized.filename, path: materialized.path };
  }
  if (!input.rawAudioPath) {
    throw new Error("Import requires an uploaded audio asset or a raw audio path.");
  }

  const rawExtension = path.extname(input.rawAudioPath).toLowerCase() || ".mp3";
  const rawAudioFile = `minimax_rap_raw${rawExtension}`;
  const rawAudioDestination = path.join(rawAudioDir, rawAudioFile);
  await copyFile(input.rawAudioPath, rawAudioDestination);
  return { filename: rawAudioFile, path: rawAudioDestination };
}

function renderProjectBrief(input: {
  topic: string;
  targetDuration: number;
  mainComposition: string;
  videoSize: string;
}): string {
  return [
    `# ${input.topic}`,
    "",
    `- Target duration: ${input.targetDuration}s`,
    `- Main composition: ${input.mainComposition}`,
    `- Video size: ${input.videoSize}`,
    "",
  ].join("\n");
}
