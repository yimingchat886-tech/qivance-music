# Issue #3 Phase 1 Design: Artifact Catalog and Standalone HyperFrames Page

## Context

Issue #3 builds on the current post-MiniMax MVP and the Issue #2 workflow surface. The app already imports accepted audio, generates timing/storyboard/HypeFrames artifacts, renders preview files, shows gate progress, and can start the official HyperFrames UI process.

This phase intentionally keeps the current workflow behavior unchanged. It adds visibility and page separation only:

- intermediate files are grouped, tracked, and downloadable from the project UI;
- the HyperFrames UI moves from the project workbench card into its own project subpage.

## Assumptions

1. `docs/06_minimax_to_hypeframes_mvp_implementation_plan_v0_3.md` remains the canonical post-MiniMax closed-loop boundary.
2. `docs/代码仓库优化方案issue 3#.md` is the source for Issue #3 scope.
3. The app remains a local Node.js / TypeScript MVP with static HTML rendering.
4. This phase does not introduce Next.js, React, Prisma, or new npm dependencies.
5. Existing HypeFrames deterministic generation, preview rendering, and button-style human approvals stay unchanged.
6. File-level downloads are enough for P0; zip or tar bundles are out of scope for this phase.

## Success Criteria

1. `/projects/:id` no longer embeds the HyperFrames iframe.
2. `/projects/:id` shows HyperFrames runtime status and a link to `/projects/:id/hyperframes`.
3. `/projects/:id/hyperframes` shows the runtime status, start/restart form, direct URL, and the iframe only when the runtime is running.
4. HyperFrames UI start success redirects to `/projects/:id/hyperframes`.
5. HyperFrames UI start failure renders the standalone subpage with the error.
6. Project downloads are grouped by workflow stage instead of hardcoded to the current small export list.
7. The UI exposes key intermediate artifacts such as `beats.locked.json`, `section_map.json`, storyboard plans, QA reports, render manifest, and final output when present.
8. `artifact_manifest.json` can be written as a snapshot of grouped artifacts.
9. Download path resolution prevents `..`, absolute-path, and path-normalization escapes.
10. `TMPDIR=/tmp npm test` passes.

## Architecture

Add one new read-oriented module and keep route ownership in `server.ts`:

```text
project files
  -> artifact-catalog.ts
  -> loadProjectSummary()
  -> renderProjectWorkspace()
  -> renderHyperframesPage()

server.ts
  -> GET /projects/:id
  -> GET /projects/:id/hyperframes
  -> POST /projects/:id/hyperframes-ui/start
  -> GET /projects/:id/download?path=...
```

`artifact-catalog.ts` owns artifact group definitions, file existence checks, size/hash metadata, group status inference, and `artifact_manifest.json` snapshot writing.

`web-ui.ts` owns rendering:

- the project workbench with grouped downloads and a HyperFrames subpage link;
- the standalone HyperFrames page with runtime controls and HypeFrames-related downloads.

`server.ts` owns routing and safe downloads. It should not learn artifact group internals beyond calling `loadProjectSummary()` and `renderHyperframesPage()`.

## Non-Goals

This phase does not implement:

- Codex CLI-driven HypeFrames generation;
- executable resolver unification;
- Timing Schema Gate strengthening;
- Scene Rule Gate strengthening;
- project bundle zip/tar downloads;
- any rewrite of `post-minimax-workflow.ts` generation behavior.

## Artifact Catalog

Define:

```ts
export type ArtifactItem = {
  label: string;
  relativePath: string;
  required: boolean;
  exists: boolean;
  sizeBytes: number | null;
  sha256: string | null;
  contentType: string;
};

export type ArtifactGroup = {
  id: string;
  label: string;
  description: string;
  qaPath: string | null;
  status: "pending" | "running" | "ready" | "warning" | "failed";
  artifacts: ArtifactItem[];
};
```

Expose:

```ts
export async function loadArtifactCatalog(projectPath: string): Promise<ArtifactGroup[]>;
export async function writeArtifactSnapshot(projectPath: string): Promise<void>;
```

`writeArtifactSnapshot()` writes:

```text
artifact_manifest.json
```

with `project_id`, `updated_at`, and the current groups.

## Artifact Groups

P0 groups:

1. Music Lock / Audio Ingest
   - `audio/raw/minimax_rap_raw.*`
   - `audio/master/minimax_rap_master.wav`
   - `audio/analysis/minimax_rap_analysis.wav`
   - `audio/music_manifest.json`
   - `audio/minimax_request_manifest.json`
   - `qa/music/music_ingest_qa_report.json`

2. Beat Lock
   - `data/timing/beats.auto.json`
   - `data/timing/beats.locked.json`
   - `data/timing/beat_diagnostics.md`
   - `qa/timing/beat_lock_qa_report.json`

3. Timing Schema Gate
   - `data/timing/section_map.json`
   - `data/timing/section_density_report.json`
   - `qa/timing/timing_qa_report.json`

4. Storyboard / Scene Rule Gate
   - `data/storyboard/scene_plan.json`
   - `data/storyboard/caption_plan.json`
   - `data/storyboard/visual_plan.json`
   - `data/storyboard/render_plan.json`
   - `qa/storyboard/scene_rule_check.json`
   - `qa/storyboard/scene_human_approval.md`

5. HypeFrames Project
   - `hypeframes/DESIGN.md`
   - `hypeframes/src/index.html`
   - `hypeframes/src/styles.css`
   - `hypeframes/src/main.js`
   - `hypeframes/src/config.json`
   - `hypeframes/generated/timeline.json`
   - `hypeframes/generated/scene_plan.json`
   - `hypeframes/generated/caption_plan.json`
   - `hypeframes/generated/visual_plan.json`
   - `hypeframes/render_targets/render_targets.json`
   - `hypeframes/hypeframes_project_manifest.json`
   - `qa/hypeframes/hypeframes_file_qa_report.json`
   - `qa/hypeframes/hypeframes_revision_notes.md`

6. Render / Preview QA
   - `dist/preview/preview_composite.mp4`
   - `dist/review/preview_composite_review.mp4`
   - `dist/render_manifest.json`
   - `qa/render/render_qa_report.json`
   - `qa/render/keyframes_contact_sheet.jpg`
   - `qa/render/preview_review_log.md`
   - `qa/master_qa_report.json`
   - `dist/final/hypeframes_final.mp4`

Codex logs are not included in Phase 1 because Codex CLI generation is not implemented yet.

## Status Mapping

Group status is derived from the QA report and file presence:

| Condition | Status |
|---|---|
| QA report missing and no group artifacts exist | `pending` |
| QA report missing and at least one group artifact exists | `running` |
| QA status is `rule_pass` or `human_approved` | `ready` |
| QA status is `rule_pass_with_warnings` or `human_pending` | `warning` |
| QA status is `rule_fail_blocked` | `failed` |

Unknown QA statuses should not throw. They should map to `pending` unless file presence indicates `running`.

## Project Summary

Extend `ProjectSummary`:

```ts
artifactGroups: ArtifactGroup[];
```

`loadProjectSummary()` should call `loadArtifactCatalog(projectPath)`.

`availableDownloads` remains for compatibility, but its source changes from the current hardcoded list to a flattened list of existing artifacts from `artifactGroups`.

## Gate Progress

Keep the existing six major stages in Phase 1. Extend `GateProgressStep` with artifact metadata:

```ts
completed: boolean;
qaPath: string | null;
artifactCount: number;
availableArtifactCount: number;
```

`renderGateProgress()` should show:

- step label;
- status;
- `Artifacts: available / total`;
- QA report path when known;
- issues and warnings.

Do not expand to the full 11-stage Issue #3 list in this phase.

## Workbench UI

The project workbench keeps existing actions and approval buttons.

The HyperFrames card changes from embedded runtime UI to a compact summary:

- current runtime status;
- direct runtime URL when known;
- link button to `/projects/:id/hyperframes`.

The QA / Export card changes from a single flat hardcoded list to grouped artifact cards. Each group shows:

- group label;
- group status;
- available artifact count;
- QA report link when present;
- downloadable files when they exist;
- missing required files as non-links.

## Standalone HyperFrames Page

Add:

```ts
export function renderHyperframesPage(project: ProjectSummary, options: { error?: string } = {}): string
```

The page shows:

- back link to `/projects/:id`;
- current workflow state;
- runtime status;
- start/restart form;
- direct runtime URL when available;
- iframe only when runtime status is `running`;
- HypeFrames Project artifacts;
- HypeFrames File QA summary when available.

## Routes

Add:

```text
GET /projects/:id/hyperframes
```

Change:

```text
POST /projects/:id/hyperframes-ui/start
```

Success redirects to:

```text
/projects/:id/hyperframes
```

Failure renders `renderHyperframesPage()` with the error and HTTP 400.

## Download Safety

Keep the existing checks:

- empty path is invalid;
- paths containing `..` are invalid;
- absolute paths are invalid.

Strengthen with normalized resolution:

```ts
const absolutePath = path.resolve(projectPath, relativePath);
if (absolutePath !== projectPath && !absolutePath.startsWith(projectPath + path.sep)) {
  // reject
}
```

This prevents path normalization escapes such as `a/../outside`.

## Testing

Add `tests/artifact-catalog.test.ts`:

1. returns all P0 groups;
2. marks existing files with size and sha256;
3. maps QA statuses to catalog statuses;
4. writes `artifact_manifest.json`.

Update `tests/gate-progress.test.ts`:

1. asserts `qaPath`;
2. asserts `artifactCount`;
3. asserts `availableArtifactCount`;
4. asserts `completed`.

Update `tests/web-ui.test.ts`:

1. project workbench has `/projects/:id/hyperframes` link;
2. project workbench does not include a HyperFrames iframe;
3. project workbench renders grouped artifact downloads;
4. `renderHyperframesPage()` includes iframe only when runtime is running;
5. `renderHyperframesPage()` shows errors on startup failure.

Run:

```bash
TMPDIR=/tmp npm test
npx gitnexus detect-changes --repo qivance-music
```

## Implementation Notes

Before editing existing symbols, run GitNexus impact analysis for:

- `loadProjectSummary`;
- `renderProjectWorkspace`;
- `renderGateProgress`;
- `route`;
- `sendDownload`.

If impact returns HIGH or CRITICAL, stop and report the blast radius before editing.

## Acceptance Checklist

- [ ] `/projects/:id` has no HyperFrames iframe.
- [ ] `/projects/:id` links to `/projects/:id/hyperframes`.
- [ ] `/projects/:id/hyperframes` renders runtime controls.
- [ ] HyperFrames start success redirects to the subpage.
- [ ] HyperFrames start failure renders the subpage with an error.
- [ ] Intermediate artifacts are grouped and downloadable.
- [ ] Missing artifacts are visible as missing, not broken links.
- [ ] `artifact_manifest.json` can be written.
- [ ] Download path resolution rejects normalized escapes.
- [ ] `TMPDIR=/tmp npm test` passes.
