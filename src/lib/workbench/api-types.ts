import type { WorkbenchProjectMode, WorkbenchProjectStatus, WorkbenchStepStatus } from "./project-status.ts";

export type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

export type V3ProjectListItem = {
  small_project_id: string;
  project_id?: string;
  title?: string;
  content_type?: string;
  source?: "file_system" | "v5_control_plane";
  mode: WorkbenchProjectMode;
  status: WorkbenchStepStatus;
  project_root: string;
};

export type V3ProjectListResponse = {
  projects: V3ProjectListItem[];
};

export type V3ProjectDetailResponse = {
  project: V3ProjectListItem;
  status: WorkbenchProjectStatus;
};

export type AnimationPlanApprovalResponse = {
  approved: true;
  approved_at: string;
  approved_by: string;
  source: string;
};

export type JsonArtifactResponse = {
  small_project_id: string;
  artifact: {
    id: string;
    exists: boolean;
    path: string;
    data?: unknown;
  };
};

export type ImageArtifactsResponse = {
  small_project_id: string;
  image_assets: JsonArtifactResponse["artifact"];
  image_review_decisions: JsonArtifactResponse["artifact"];
};
