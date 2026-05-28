export type WorkflowState =
  | "music_locking"
  | "music_locked"
  | "music_ingest_failed"
  | "beat_locking"
  | "beat_locked"
  | "beat_lock_needs_review"
  | "section_mapping"
  | "section_mapped"
  | "timing_checking"
  | "timing_passed"
  | "timing_failed"
  | "storyboard_generating"
  | "storyboard_generated"
  | "scene_rule_checking"
  | "scene_rule_passed"
  | "scene_waiting_human"
  | "scene_human_approved"
  | "scene_human_rejected"
  | "hypeframes_generating"
  | "hypeframes_project_ready"
  | "hypeframes_file_qa_checking"
  | "hypeframes_file_qa_passed"
  | "hypeframes_file_qa_failed"
  | "preview_rendering"
  | "preview_rendered"
  | "render_file_qa_checking"
  | "render_file_qa_passed"
  | "render_file_qa_failed"
  | "preview_waiting_human"
  | "preview_revision_requested"
  | "preview_human_approved"
  | "hypeframes_video_ready"
  | "failed";

export const postMinimaxPath = [
  "music_locking",
  "music_locked",
  "beat_locking",
  "beat_locked",
  "section_mapping",
  "section_mapped",
  "timing_checking",
  "timing_passed",
  "storyboard_generating",
  "storyboard_generated",
  "scene_rule_checking",
  "scene_rule_passed",
  "scene_waiting_human",
  "scene_human_approved",
  "hypeframes_generating",
  "hypeframes_project_ready",
  "hypeframes_file_qa_checking",
  "hypeframes_file_qa_passed",
  "preview_rendering",
  "preview_rendered",
  "render_file_qa_checking",
  "render_file_qa_passed",
  "preview_waiting_human",
  "preview_human_approved",
  "hypeframes_video_ready",
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
