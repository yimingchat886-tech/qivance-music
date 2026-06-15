import { access } from "node:fs/promises";
import path from "node:path";
import { sha256File, writeJson } from "../fs-utils.ts";
import {
  isTerminalTaskStatus,
  stableTaskId,
  type ArtifactSnapshotEntry,
  type ExecutionPlan,
  type SchedulerMode,
  type SchedulerResource,
  type SchedulerTask,
  type SchedulerTaskStage,
} from "./scheduler-types.ts";

export type BuildExecutionPlanInput = {
  storageRoot: string;
  projectId: string;
  chains: string[];
  runId: string;
  mode?: SchedulerMode;
  priority?: number;
  diagnosticAllowed?: boolean;
  now?: string;
};

const CHAT_CHAIN_ID = "chat_dialogue_mv";
const TIMING_PATHS = [
  "data/timing/beat_grid.json",
  "data/timing/onset_events.json",
  "data/timing/energy_curve.json",
  "data/timing/lyric_word_timing.json",
  "data/timing/alignment_report.json",
  "data/timing/section_map.json",
];

export async function buildExecutionPlan(input: BuildExecutionPlanInput): Promise<ExecutionPlan> {
  const mode = input.mode ?? "production";
  const priority = input.priority ?? 50;
  const diagnosticAllowed = input.diagnosticAllowed ?? false;
  const now = input.now ?? new Date().toISOString();
  const projectRoot = path.join(input.storageRoot, input.projectId);
  const snapshot = await snapshotArtifacts(projectRoot, ["lyrics.md", "active_music_take.mp3", ...TIMING_PATHS]);
  const tasks: SchedulerTask[] = [];

  const resolveInputs = task(input, "project", "resolve_project_inputs", [], ["lyrics.md", "active_music_take.mp3"], [], {
    status: snapshot["lyrics.md"]?.exists && snapshot["active_music_take.mp3"]?.exists ? "ready" : "blocked",
    priority,
    diagnosticAllowed,
  });
  tasks.push(resolveInputs);

  const timingReady = TIMING_PATHS.every((artifactPath) => snapshot[artifactPath]?.exists);
  const resolveTiming = task(input, "project", "resolve_timing_bundle", [resolveInputs.task_id], TIMING_PATHS, [], {
    status: timingReady ? "skipped" : "ready",
    priority,
    diagnosticAllowed,
  });
  tasks.push(resolveTiming);

  const timingWriter = task(input, "project", "run_timing_pipeline", [resolveTiming.task_id], ["lyrics.md", "active_music_take.mp3"], TIMING_PATHS, {
    status: timingReady ? "skipped" : mode === "production" && !diagnosticAllowed ? "blocked" : "ready",
    priority,
    diagnosticAllowed,
    resources: ["cpu_heavy", "gpu_whisperx", "filesystem_write"],
  });
  tasks.push(timingWriter);

  const timingDependency = timingReady ? resolveTiming.task_id : timingWriter.task_id;
  for (const chain of input.chains) {
    if (chain === CHAT_CHAIN_ID) {
      tasks.push(...buildChatTasks(input, timingDependency, priority, diagnosticAllowed, snapshot));
    } else {
      tasks.push(task(input, chain, `run_existing_chain_${chain}`, [timingDependency], [], [`exports/${chain}/render_manifest.json`], {
        status: "ready",
        priority,
        diagnosticAllowed,
        resources: ["cpu_light"],
      }));
    }
  }

  return {
    schema_version: 1,
    run_id: input.runId,
    project_id: input.projectId,
    chains: input.chains,
    mode,
    artifact_snapshot: snapshot,
    tasks,
    created_at: now,
    updated_at: now,
  };
}

export async function writeExecutionPlan(storageRoot: string, plan: ExecutionPlan): Promise<string> {
  const filePath = path.join(storageRoot, plan.project_id, "data", "scheduler", "execution_plan.json");
  await writeJson(filePath, plan);
  return filePath;
}

export function markRunnableTasks(plan: ExecutionPlan): ExecutionPlan {
  const byId = new Map(plan.tasks.map((taskItem) => [taskItem.task_id, taskItem]));
  const tasks = plan.tasks.map((taskItem) => {
    if (taskItem.status !== "planned" && taskItem.status !== "blocked") return taskItem;
    const dependenciesDone = taskItem.dependencies.every((dependency) => {
      const dependencyTask = byId.get(dependency);
      return dependencyTask && isTerminalTaskStatus(dependencyTask.status) && dependencyTask.status !== "failed" && dependencyTask.status !== "cancelled";
    });
    if (!dependenciesDone) return taskItem;
    return { ...taskItem, status: "ready" as const };
  });
  return { ...plan, tasks };
}

async function snapshotArtifacts(projectRoot: string, artifactPaths: string[]): Promise<Record<string, ArtifactSnapshotEntry>> {
  const entries: Record<string, ArtifactSnapshotEntry> = {};
  for (const artifactPath of artifactPaths) {
    const absolutePath = path.join(projectRoot, artifactPath);
    const exists = await fileExists(absolutePath);
    entries[artifactPath] = {
      exists,
      path: artifactPath,
      sha256: exists ? await sha256File(absolutePath) : undefined,
    };
  }
  return entries;
}

function buildChatTasks(
  input: BuildExecutionPlanInput,
  timingDependency: string,
  priority: number,
  diagnosticAllowed: boolean,
  snapshot: Record<string, ArtifactSnapshotEntry>,
): SchedulerTask[] {
  const definitions: Array<{
    stage: SchedulerTaskStage;
    dependencies: SchedulerTaskStage[];
    inputs: string[];
    outputs: string[];
    resources?: SchedulerResource[];
  }> = [
    {
      stage: "build_lyrics_line_map",
      dependencies: [],
      inputs: ["lyrics.md"],
      outputs: ["data/chains/chat_dialogue_mv/lyrics_line_map.json"],
    },
    {
      stage: "build_speaker_attribution",
      dependencies: ["build_lyrics_line_map"],
      inputs: ["data/chains/chat_dialogue_mv/lyrics_line_map.json"],
      outputs: ["data/chains/chat_dialogue_mv/speaker_attribution.json"],
    },
    {
      stage: "build_conversation_plan",
      dependencies: ["build_speaker_attribution"],
      inputs: [
        "data/chains/chat_dialogue_mv/lyrics_line_map.json",
        "data/chains/chat_dialogue_mv/speaker_attribution.json",
        "data/timing/lyric_word_timing.json",
        "data/timing/section_map.json",
      ],
      outputs: ["data/chains/chat_dialogue_mv/conversation_plan.json"],
    },
    {
      stage: "build_chain_animation_plan",
      dependencies: ["build_conversation_plan"],
      inputs: ["data/chains/chat_dialogue_mv/conversation_plan.json"],
      outputs: ["data/chains/chat_dialogue_mv/animation_plan.json"],
    },
    {
      stage: "build_chat_frame_contracts",
      dependencies: ["build_chain_animation_plan"],
      inputs: ["data/chains/chat_dialogue_mv/animation_plan.json"],
      outputs: ["data/chains/chat_dialogue_mv/frame_contracts.json"],
    },
    {
      stage: "build_chat_frames",
      dependencies: ["build_chat_frame_contracts"],
      inputs: ["data/chains/chat_dialogue_mv/frame_contracts.json"],
      outputs: ["video/html-video/.html-video/projects/<project_id>/frames/chat_dialogue_mv_001.html"],
      resources: ["html_video_agent", "filesystem_write"],
    },
    {
      stage: "validate_frames",
      dependencies: ["build_chat_frames"],
      inputs: ["data/chains/chat_dialogue_mv/frame_contracts.json"],
      outputs: [],
    },
    {
      stage: "build_preview",
      dependencies: ["validate_frames"],
      inputs: ["data/chains/chat_dialogue_mv/frame_contracts.json"],
      outputs: [],
    },
    {
      stage: "render_visual",
      dependencies: ["build_preview"],
      inputs: ["data/chains/chat_dialogue_mv/frame_contracts.json"],
      outputs: ["exports/chat_dialogue_mv/visual.mp4"],
      resources: ["chromium_render", "ffmpeg", "filesystem_write"],
    },
    {
      stage: "mux_audio",
      dependencies: ["render_visual"],
      inputs: ["exports/chat_dialogue_mv/visual.mp4", "active_music_take.mp3"],
      outputs: ["exports/chat_dialogue_mv/final.mp4"],
      resources: ["ffmpeg", "filesystem_write"],
    },
    {
      stage: "run_media_qa",
      dependencies: ["mux_audio"],
      inputs: ["exports/chat_dialogue_mv/final.mp4"],
      outputs: ["data/chains/chat_dialogue_mv/qa_report.json"],
      resources: ["ffmpeg"],
    },
    {
      stage: "write_render_manifest",
      dependencies: ["run_media_qa"],
      inputs: ["data/chains/chat_dialogue_mv/qa_report.json"],
      outputs: ["exports/chat_dialogue_mv/render_manifest.json"],
    },
    {
      stage: "write_chain_status",
      dependencies: ["write_render_manifest"],
      inputs: ["exports/chat_dialogue_mv/render_manifest.json"],
      outputs: ["data/chains/chat_dialogue_mv/chain_status.json"],
    },
  ];

  const ids = new Map<SchedulerTaskStage, string>();
  for (const definition of definitions) ids.set(definition.stage, stableTaskId(["task", input.projectId, CHAT_CHAIN_ID, definition.stage]));

  return definitions.map((definition) => {
    const dependencies = definition.dependencies.map((dependency) => ids.get(dependency)!).filter(Boolean);
    if (definition.stage === "build_conversation_plan") dependencies.unshift(timingDependency);
    const outputsExist = definition.outputs.length > 0 && definition.outputs.every((outputPath) => snapshot[outputPath]?.exists);
    return task(input, CHAT_CHAIN_ID, definition.stage, dependencies, definition.inputs, definition.outputs, {
      status: outputsExist ? "skipped" : dependencies.length === 0 ? "ready" : "planned",
      priority,
      diagnosticAllowed,
      resources: definition.resources,
    });
  });
}

function task(
  input: BuildExecutionPlanInput,
  chainId: string,
  stage: SchedulerTaskStage,
  dependencies: string[],
  inputPaths: string[],
  outputPaths: string[],
  options: {
    status: SchedulerTask["status"];
    priority: number;
    diagnosticAllowed: boolean;
    resources?: SchedulerResource[];
  },
): SchedulerTask {
  return {
    task_id: stableTaskId(["task", input.projectId, chainId, stage]),
    run_id: input.runId,
    project_id: input.projectId,
    chain_id: chainId,
    stage,
    status: options.status,
    priority: options.priority,
    dependencies,
    resource_requirements: options.resources ?? ["cpu_light", "filesystem_write"],
    input_paths: inputPaths,
    output_paths: outputPaths,
    input_hashes: {},
    output_hashes: {},
    diagnostic_allowed: options.diagnosticAllowed,
    retry_count: 0,
    last_error: null,
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
