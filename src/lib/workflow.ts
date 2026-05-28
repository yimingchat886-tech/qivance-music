export type WorkflowState =
  | "music_accepted"
  | "beat_locking"
  | "beat_locked"
  | "beat_needs_review"
  | "beat_blocked"
  | "section_mapping"
  | "timing_qa_running"
  | "timing_ready"
  | "timing_needs_review"
  | "timing_blocked"
  | "scene_planning"
  | "scene_qa_running"
  | "scene_ready"
  | "scene_needs_review"
  | "scene_blocked"
  | "hypeframes_generating"
  | "hypeframes_file_qa_running"
  | "hypeframes_ready"
  | "hypeframes_blocked"
  | "preview_rendering"
  | "preview_ready"
  | "render_qa_running"
  | "render_passed"
  | "render_blocked"
  | "export_ready"
  | "failed";

export const postMinimaxPath = [
  "music_accepted",
  "beat_locking",
  "beat_locked",
  "section_mapping",
  "timing_qa_running",
  "timing_ready",
  "scene_planning",
  "scene_qa_running",
  "scene_ready",
  "hypeframes_generating",
  "hypeframes_file_qa_running",
  "hypeframes_ready",
  "preview_rendering",
  "preview_ready",
  "render_qa_running",
  "render_passed",
  "export_ready",
] as const;

export type WorkflowEvent = "advance" | WorkflowState;

const advanceMap = new Map<WorkflowState, WorkflowState>(
  postMinimaxPath.slice(0, -1).map((state, index) => [
    state,
    postMinimaxPath[index + 1],
  ]) as Array<[WorkflowState, WorkflowState]>,
);

export function nextStateForStep(current: WorkflowState, event: WorkflowEvent): WorkflowState {
  if (event === "advance") {
    const next = advanceMap.get(current);
    if (!next) {
      throw new Error(`Invalid workflow event advance from ${current}`);
    }
    return next;
  }

  const allowed = advanceMap.get(current);
  if (allowed === event) {
    return event;
  }

  throw new Error(`Invalid workflow event ${event} from ${current}`);
}

