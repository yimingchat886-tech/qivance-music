type ImageDecision = {
  candidateId: string;
  sceneId: string;
  role: "background";
  path: string;
  sha256: string;
  prompt: string;
  status: "locked" | "rejected" | "skipped";
};

export function buildLockedImageAssets(input: { smallProjectId: string; decisions: ImageDecision[] }) {
  return {
    schema_version: 1,
    small_project_id: input.smallProjectId,
    assets: input.decisions
      .filter((decision) => decision.status === "locked")
      .map((decision) => ({
        asset_id: decision.candidateId,
        scene_id: decision.sceneId,
        role: decision.role,
        path: decision.path,
        sha256: decision.sha256,
        source: "codex_image_gen",
        status: "locked",
        prompt: decision.prompt,
        created_at: new Date().toISOString(),
      })),
  };
}
