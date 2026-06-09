export function validateAlignmentOverride(value: any): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (value?.schema_version !== 1) issues.push("alignment_override.schema_version must be 1");
  if (typeof value?.override_author !== "string" || value.override_author.length === 0) {
    issues.push("override_author is required");
  }
  if (typeof value?.reason !== "string" || value.reason.length === 0) {
    issues.push("reason is required");
  }
  if (!Array.isArray(value?.changed_ranges) || value.changed_ranges.length === 0) {
    issues.push("changed_ranges must be non-empty");
  }

  for (const range of value?.changed_ranges ?? []) {
    if (!Array.isArray(range.word_ids) || range.word_ids.length === 0) {
      issues.push("changed range word_ids must be non-empty");
    }
    if (typeof range.new_start_sec !== "number" || typeof range.new_end_sec !== "number") {
      issues.push("changed range must provide timing only");
    }
    if (range.text !== undefined || range.normalized_text !== undefined) {
      issues.push("override must not modify lyric text");
    }
  }

  return { ok: issues.length === 0, issues };
}
