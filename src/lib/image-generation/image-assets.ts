export type ImageAssetReviewStatus = "locked" | "rejected" | "skipped";

export type ImageAssetReviewDecision = {
  candidateId: string;
  status: ImageAssetReviewStatus;
  reason?: string;
  decidedBy?: string;
  decidedAt?: string;
};

export type ImageAssetReviewDecisionFile = {
  schema_version: 1;
  small_project_id: string;
  decisions: ImageAssetReviewDecision[];
};

export type ImageDecision = {
  candidateId: string;
  sceneId: string;
  role: "background";
  path: string;
  sha256: string;
  prompt: string;
  status: ImageAssetReviewStatus;
  decisionSource?: string;
  reason?: string;
  decidedBy?: string;
  decidedAt?: string;
};

export type ImageAssetReviewValidationResult = {
  ok: boolean;
  issues: string[];
  decisions: ImageAssetReviewDecision[];
};

export function validateImageAssetReviewDecisionFile(input: {
  review: unknown;
  smallProjectId: string;
  candidateIds: string[];
}): ImageAssetReviewValidationResult {
  const issues: string[] = [];
  const candidateIds = new Set(input.candidateIds);
  const review = isRecord(input.review) ? input.review : null;
  const decisions: ImageAssetReviewDecision[] = [];

  if (!review) {
    return { ok: false, issues: ["image review decision file must be a JSON object"], decisions };
  }
  if (review.schema_version !== 1) issues.push("image review decision schema_version must be 1");
  if (review.small_project_id !== input.smallProjectId) {
    issues.push(`image review decision small_project_id must be ${input.smallProjectId}`);
  }
  if (!Array.isArray(review.decisions)) {
    issues.push("image review decision file must contain decisions[]");
    return { ok: false, issues, decisions };
  }

  const seen = new Set<string>();
  for (const rawDecision of review.decisions) {
    if (!isRecord(rawDecision)) {
      issues.push("image review decision entries must be objects");
      continue;
    }
    const candidateId = stringValue(rawDecision.candidate_id) ?? stringValue(rawDecision.candidateId);
    const status = reviewStatus(rawDecision.status);
    if (!candidateId) {
      issues.push("image review decision candidate_id is required");
      continue;
    }
    if (seen.has(candidateId)) issues.push(`duplicate image review decision for candidate ${candidateId}`);
    seen.add(candidateId);
    if (!candidateIds.has(candidateId)) issues.push(`image review decision references unknown candidate ${candidateId}`);
    if (!status) {
      issues.push(`image review decision status for ${candidateId} must be locked, rejected, or skipped`);
      continue;
    }
    decisions.push({
      candidateId,
      status,
      ...(typeof rawDecision.reason === "string" ? { reason: rawDecision.reason } : {}),
      ...(typeof rawDecision.decided_by === "string" ? { decidedBy: rawDecision.decided_by } : {}),
      ...(typeof rawDecision.decidedBy === "string" ? { decidedBy: rawDecision.decidedBy } : {}),
      ...(typeof rawDecision.decided_at === "string" ? { decidedAt: rawDecision.decided_at } : {}),
      ...(typeof rawDecision.decidedAt === "string" ? { decidedAt: rawDecision.decidedAt } : {}),
    });
  }

  return { ok: issues.length === 0, issues, decisions };
}

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
        review: {
          source: decision.decisionSource ?? "unknown",
          status: decision.status,
          ...(decision.reason ? { reason: decision.reason } : {}),
          ...(decision.decidedBy ? { decided_by: decision.decidedBy } : {}),
          ...(decision.decidedAt ? { decided_at: decision.decidedAt } : {}),
        },
      })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function reviewStatus(value: unknown): ImageAssetReviewStatus | null {
  return value === "locked" || value === "rejected" || value === "skipped" ? value : null;
}
