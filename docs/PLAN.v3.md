# V3 Production Workbench Implementation Plan

> **Source PRD:** `docs/qivance_music_html_video_integration_prd.v3.md`
> **Source SPEC:** `docs/SPEC.v3.md`
> **Status:** Implemented and verified
> **Tech stack:** TypeScript, Node HTTP server, file-system project model, html-video packages, Codex image_gen adapter, ffmpeg/ffprobe, Playwright/Chrome for render smoke where available.

---

## 0. Implementation Rules

- Preserve V2 production-strict behavior. Do not weaken existing media/export evidence gates.
- Keep V3 file-model first. Do not introduce Prisma, SQLite, Postgres, or any DB abstraction.
- Serve the V3 Workbench from the current Node service. Do not introduce Next.js, React, Vite, or a separate frontend app in V3.
- Do not implement upstream creation/generation flows: no new project wizard, uploads, DeepSeek, MiniMax, Obsidian/RAG, active take selection, or LLM prompt rewriting.
- Production agent runs must fail on timeout, non-clean exit, invalid frames, missing AI-authored frame paths, or fallback frame use.
- Diagnostic fallback frames require an explicit diagnostic flag and cannot count as V3 success.
- Tests should isolate external dependencies; local production E2E records real evidence in `docs/TEST_REPORT.v3.md`.

---

## 1. File Structure

### Create

```text
docs/TEST_REPORT.v3.md

src/lib/workbench/project-status.ts
src/lib/workbench/workbench-html.ts
src/lib/workbench/api-types.ts

src/lib/image-generation/image-schedule.ts
src/lib/image-generation/image-prompt-group.ts
src/lib/image-generation/image-review-decisions.ts

src/lib/video-html/source-video-import.ts
src/lib/video-html/agent-run-log.ts

tests/workbench-project-status.test.ts
tests/workbench-api.test.ts
tests/workbench-html.test.ts
tests/image-generation-schedule.test.ts
tests/image-prompt-group.test.ts
tests/image-review-decisions.test.ts
tests/source-video-import.test.ts
tests/html-video-agent-production-gate.test.ts
tests/render-manifest-v3.test.ts
```

Exact file names may be adjusted during implementation if existing modules provide a better home, but new responsibilities should stay close to these boundaries.

### Modify

```text
src/server.ts
src/lib/project-core/paths.ts
src/lib/media-e2e/workflow.ts
src/lib/media-e2e/types.ts
src/lib/image-generation/codex-image-gen-adapter.ts
src/lib/image-generation/image-assets.ts
src/lib/video-html/html-video-agent-runtime.ts
src/lib/video-html/frame-output-contract-validator.ts
src/lib/video-html/html-video-workspace.ts
src/lib/video-html/preview-model.ts
src/lib/export/render-manifest-v2.ts
src/lib/export/mux-locked-audio.ts
src/lib/export/media-qa.ts
scripts/e2e-media-v2.ts
package.json
docs/requirements traceability matrix.md
```

Do not modify vendor html-video packages unless the implementation proves the boundary cannot be met from Qivance wrapper code.

---

## Task 1: Project Status Aggregator

### Goal

Build the file-model status layer that the Workbench and API can use without hardcoding project directory details in page code.

### Implement

- Add a status reader that accepts `storageRoot` and `smallProjectId`.
- Detect `image_music_mode`, `source_video_mode`, blocked mode, and conflicting mode.
- Read known artifacts:
  - `active_music_take.mp3`
  - `lyrics.md`
  - `animation_plan.json`
  - `image_generation_plan.json`
  - `data/timing/*.json`
  - `data/storyboard/section_map.json`
  - `data/storyboard/image_generation_schedule.json`
  - `data/storyboard/image_prompt_group.json`
  - `data/storyboard/image_assets.json`
  - `data/storyboard/image_review_decisions.json`
  - `data/source/source_video_import.json`
  - html-video project files
  - `exports/render_manifest.json`
  - `exports/final.mp4`
- Return normalized step statuses:
  - `not_started`
  - `ready`
  - `running`
  - `passed`
  - `blocked`
  - `failed`
  - `diagnostic_only`
- Include blocking reasons with stable codes.

### Tests

```bash
node --experimental-strip-types --test tests/workbench-project-status.test.ts
npm run typecheck
```

### Acceptance

- Existing V2 fixture project returns a meaningful status object.
- Missing input files produce explicit blocking reasons.
- Source video mode can be detected from `source_video.mp4` or `source_video_import.json`.

---

## Task 2: V3 API Routes

### Goal

Expose the V3 file model through stable API endpoints consumed by the basic Workbench page and future Next.js rewrite.

### Implement

Add or extend routes in `src/server.ts`:

```text
GET  /api/projects
GET  /api/projects/:id
GET  /api/projects/:id/status
POST /api/projects/:id/animation-plan/approve
GET  /api/projects/:id/images
GET  /api/projects/:id/images/schedule
POST /api/projects/:id/images/schedule/recommend
POST /api/projects/:id/images/schedule
GET  /api/projects/:id/images/prompt-group
POST /api/projects/:id/images/prompt-group
POST /api/projects/:id/images/:assetId/lock
POST /api/projects/:id/images/:assetId/reject
POST /api/projects/:id/images/skip
POST /api/projects/:id/images/run-generation
POST /api/projects/:id/source-video/import
POST /api/projects/:id/html-video/run-agent
POST /api/projects/:id/html-video/revise
GET  /api/projects/:id/html-video/preview
POST /api/projects/:id/export/render
GET  /api/projects/:id/export/final.mp4
```

Implementation can stage endpoints over tasks, but route names should match SPEC unless an implementation note records a deliberate change.

### Tests

```bash
node --experimental-strip-types --test tests/workbench-api.test.ts
npm run typecheck
```

### Acceptance

- API can list and inspect existing projects without creating directories.
- Mutating routes validate project id, path boundaries, and JSON request body.
- API errors return clear JSON diagnostics.

---

## Task 3: Animation Plan Approval

### Goal

Make Animation Plan confirmation an explicit Workbench/API state before image schedule or agent production work.

### Implement

- Add approval metadata storage in `workflow_checkpoints.json` or a sidecar file.
- Implement `POST /api/projects/:id/animation-plan/approve`.
- Status aggregator must reflect approved/unapproved state.
- Do not mutate `animation_plan.json` semantic content to fake approval.

### Tests

```bash
node --experimental-strip-types --test tests/workbench-project-status.test.ts tests/workbench-api.test.ts
```

### Acceptance

- Unapproved Animation Plan blocks downstream production actions.
- Approval is visible in status API and Workbench.

---

## Task 4: Image Schedule Contract

### Goal

Create `image_generation_schedule.json` from `section_map.json` and support manual adjustment before image generation.

### Implement

- Add `src/lib/image-generation/image-schedule.ts`.
- Read `data/storyboard/section_map.json`.
- Recommend image slots based on:
  - scene count
  - scene duration
  - visual change density when available
  - reusable locked assets when available
- Write `data/storyboard/image_generation_schedule.json`.
- Validate user edits:
  - image id uniqueness
  - scene id exists
  - time range stays inside scene/section range
  - target size/aspect ratio is valid
  - skipped items cannot require prompts or generation

### Tests

```bash
node --experimental-strip-types --test tests/image-generation-schedule.test.ts
npm run typecheck
```

### Acceptance

- Schedule can be recommended from a V2 fixture section map.
- User-edited schedule validates correctly.
- Invalid time ranges and missing scenes fail with clear diagnostics.

---

## Task 5: Image Prompt Group Contract

### Goal

Create and validate one small-project prompt group: one shared style plus per-image scene prompts.

### Implement

- Add `src/lib/image-generation/image-prompt-group.ts`.
- Define a small built-in style option set.
- Enforce exactly one selected style per project.
- Enforce prompt entries for all non-skipped schedule items.
- Build final prompt:

```text
small-project style prompt + per-image scene prompt + generation constraints
```

- Store:
  - selected style
  - scene prompt
  - manual override flag
  - final prompt
  - provenance
  - `llm_assisted: false`
- Record that LLM prompt assistance is deferred.

### Tests

```bash
node --experimental-strip-types --test tests/image-prompt-group.test.ts
npm run typecheck
```

### Acceptance

- Prompt group can be created for a schedule.
- Changing style marks prompts as needing reconfirmation.
- Final adapter prompts are derived only from confirmed prompt text.

---

## Task 6: Image Review Decisions And Adapter Wiring

### Goal

Turn V2 automatic image locking into a productized accept/reject/skip/regenerate loop.

### Implement

- Add `src/lib/image-generation/image-review-decisions.ts`.
- Add `data/storyboard/image_review_decisions.json`.
- Implement review actions:
  - lock
  - reject
  - skip
  - regenerate
- Lock action updates `image_assets.json`.
- Reject action prevents candidate entry into ContentGraph/agent context.
- Skip action records scene/image skip state for downstream frame contract.
- Regenerate keeps project style by default and may update only target scene prompt.
- Wire image generation request prompt to confirmed prompt group final prompt.

### Tests

```bash
node --experimental-strip-types --test tests/image-review-decisions.test.ts tests/image-generation-assets.test.ts tests/codex-image-gen-parent-wrapper.test.ts
npm run typecheck
```

### Acceptance

- Unlocked candidates cannot enter html-video workspace.
- Lock/reject/skip/regenerate decisions persist and are visible through API.
- Regenerate uses confirmed prompt text and preserves style unless the prompt group is reconfirmed.

---

## Task 7: Source MP4 Import And Locked Video Asset

### Goal

Support the independent local MP4 path while preserving source video audio.

### Implement

- Add `src/lib/video-html/source-video-import.ts`.
- Implement `POST /api/projects/:id/source-video/import`.
- Accept only project-local or copied local MP4 files.
- Reject remote URLs in production.
- Run ffprobe or reuse existing ffprobe helper to record:
  - duration
  - width
  - height
  - video codec
  - audio stream count
  - audio codec
  - sha256
- Write `data/source/source_video_import.json`.
- Extend html-video agent context with locked local video asset.
- Extend frame validator to reject unregistered local video files and all remote video URLs.

### Tests

```bash
node --experimental-strip-types --test tests/source-video-import.test.ts tests/frame-output-contract-validator.test.ts
npm run typecheck
```

### Acceptance

- Local MP4 import records ffprobe and sha evidence.
- Remote URL import fails.
- Frame HTML can reference only the locked local source video asset.

---

## Task 8: Production Agent Run Gate

### Goal

Make AI-authored frame generation the production gate and remove fallback-frame success from V3 production.

### Implement

- Add `src/lib/video-html/agent-run-log.ts`.
- Wrap html-video runtime results in agent run logs.
- Record:
  - operation
  - production/diagnostic mode
  - started/finished timestamps
  - exit code
  - timed_out
  - changed files
  - AI-authored frame paths
  - validation result
  - diagnostics
- Production mode fails if:
  - timeout
  - non-zero exit
  - no AI-authored frames
  - fallback frame used
  - forbidden path changed
  - frame validation fails
- Diagnostic mode may use fallback only with explicit option.

### Tests

```bash
node --experimental-strip-types --test tests/html-video-agent-runtime.test.ts tests/html-video-agent-production-gate.test.ts tests/contract-frame-fallback.test.ts
npm run typecheck
```

### Acceptance

- Production timeout is failure, not fallback success.
- Diagnostic fallback is clearly marked and excluded from production evidence.
- Agent run logs are available through status API and render manifest inputs.

---

## Task 9: Preview Revision Flow

### Goal

Support one natural-language revision request scoped to current scene or whole project.

### Implement

- Add `revision_request.json` writer/reader.
- Implement `POST /api/projects/:id/html-video/revise`.
- Request body:

```json
{
  "scope": { "type": "scene", "scene_id": "scene_001_hook" },
  "request": "Make the opening feel more like a rap classroom."
}
```

- Invoke html-video agent runtime in production mode.
- Validate changed files and frame contracts.
- Refresh Preview model after success.
- Record a revision agent run.

### Tests

```bash
node --experimental-strip-types --test tests/workbench-api.test.ts tests/html-video-agent-production-gate.test.ts tests/html-video-frame-output-validator.test.ts
npm run typecheck
```

### Acceptance

- Empty or multi-request revision payloads fail validation.
- Successful revision records request and agent run evidence.
- Failed revision does not overwrite production success state.

---

## Task 10: Render Manifest v3 Evidence

### Goal

Extend render evidence so V3 production success can be audited without reading chat logs.

### Implement

- Extend manifest writer with V3 evidence:
  - workbench project mode
  - primary ratio
  - image schedule path/hash
  - prompt group path/hash
  - review decisions path/hash
  - agent run paths/hashes
  - source video import path/hash when applicable
  - production evidence flags
- For source video mode, record:
  - `audio_policy: preserve_source_audio`
  - source MP4 sha
  - final audio source
  - ffprobe evidence
- Fail production manifest if fallback frames or diagnostic flags were used.

### Tests

```bash
node --experimental-strip-types --test tests/render-manifest-v3.test.ts tests/media-e2e-workflow.test.ts
npm run typecheck
```

### Acceptance

- Manifest proves whether run was production or diagnostic.
- Source MP4 path proves original audio was preserved.
- Missing review decisions or agent run evidence blocks production success.

---

## Task 11: Basic Workbench Page

### Goal

Ship a minimal operational UI from the current Node service.

### Implement

- Update `/projects` to list existing projects/fixtures with status summary.
- Add `/projects/:id` detail page.
- Render sections:
  - status and blocking reasons
  - input files
  - steps
  - Animation Plan approval
  - image schedule
  - image prompt group
  - image review
  - source MP4 status
  - Preview iframe
  - revision form
  - agent run summary
  - export/download
- Use simple HTML/CSS/JS served by `src/server.ts` or helper functions.
- Do not add a new frontend build system.

### Tests

```bash
node --experimental-strip-types --test tests/workbench-html.test.ts tests/server-urls.test.ts
npm run typecheck
```

### Acceptance

- Workbench can open an existing V2 fixture project.
- Buttons call API endpoints and refresh status.
- The page clearly displays blocked/failed/diagnostic states.

---

## Task 12: Source MP4 E2E Fixture

### Goal

Create a small local source MP4 fixture path for validation without relying on remote URLs.

### Implement

- Add or generate a small test fixture under `fixtures/` if repository size allows.
- If binary fixture is too large, use a script-generated MP4 in tests or E2E setup.
- Ensure source video mode can:
  - import MP4
  - lock video asset
  - write html-video context
  - produce AI-authored frame HTML referencing locked local video
  - render/export final MP4
  - preserve original audio

### Tests

```bash
node --experimental-strip-types --test tests/source-video-import.test.ts tests/render-manifest-v3.test.ts
```

### Acceptance

- Source MP4 path is tested without remote network access.
- Final evidence records source MP4 audio preservation.

---

## Task 13: Primary-Ratio Product E2E

### Goal

Prove one primary ratio completes the V3 productized flow end to end.

### Implement

- Add or extend an E2E script, e.g. `scripts/e2e-product-v3.ts`.
- Use primary ratio default `9:16` unless fixture metadata says otherwise.
- Drive API flow:
  1. validate existing project/fixture
  2. approve Animation Plan
  3. recommend image schedule
  4. confirm prompt group
  5. run image generation or use production-allowed existing candidates only when evidence is valid
  6. review/lock images
  7. run production html-video agent
  8. load Preview model
  9. submit one revision
  10. render/export
  11. write manifest and report evidence
- The script must fail if fallback or diagnostic mode is used.

### Verification Command

```bash
QIVANCE_CODEX_IMAGE_GEN_CMD=/home/jym/workspace/qivance-music/scripts/codex-image-gen-parent-wrapper.ts \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome \
node --experimental-strip-types scripts/e2e-product-v3.ts --primary
```

### Acceptance

- Primary ratio has full Workbench/API/revision/render/export evidence.
- AI-authored frames are present and validated.
- `docs/TEST_REPORT.v3.md` records exact commands and artifact paths.

---

## Task 14: Three-Ratio Production-Strict Regression

### Goal

Keep V2 media/export proof from regressing while V3 adds product flow.

### Implement

- Extend current media E2E script or create `scripts/e2e-media-v3-regression.ts`.
- Run all three ratios:
  - 9:16
  - 16:9
  - 1:1
- Enforce production-strict flags:
  - no cached/seeded imagegen unless explicitly diagnostic and not counted
  - no fallback frames
  - no missing review decisions
  - no CPU-only diagnostic WhisperX as production success

### Verification Command

```bash
QIVANCE_CODEX_IMAGE_GEN_CMD=/home/jym/workspace/qivance-music/scripts/codex-image-gen-parent-wrapper.ts \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome \
node --experimental-strip-types scripts/e2e-media-v3-regression.ts --all
```

### Acceptance

- All three ratios pass production-strict media/export regression.
- Failures clearly identify the missing production evidence.

---

## Task 15: TEST_REPORT.v3 And Traceability

### Goal

Record V3 evidence and update documentation.

### Implement

Create `docs/TEST_REPORT.v3.md` with:

```text
- date, branch, commit
- PRD/SPEC/PLAN references
- primary ratio product E2E command and result
- three-ratio regression command and result
- Workbench/API evidence
- image schedule evidence
- prompt group evidence
- image review evidence
- source MP4 evidence
- agent run evidence
- Preview revision evidence
- render/export evidence
- remaining gaps
```

Update `docs/requirements traceability matrix.md`:

```text
- V3 implemented / partial / deferred states
- test evidence paths
- next-version decisions
```

### Acceptance

- Report can be read without inspecting raw logs.
- Traceability matrix maps PRD v3 requirements to evidence and gaps.

---

## Task 16: Final Verification

### Required Checks

Run the focused test set first:

```bash
node --experimental-strip-types --test \
  tests/workbench-project-status.test.ts \
  tests/workbench-api.test.ts \
  tests/workbench-html.test.ts \
  tests/image-generation-schedule.test.ts \
  tests/image-prompt-group.test.ts \
  tests/image-review-decisions.test.ts \
  tests/source-video-import.test.ts \
  tests/html-video-agent-production-gate.test.ts \
  tests/render-manifest-v3.test.ts
```

Run broad checks:

```bash
npm run typecheck
node --experimental-strip-types --test tests/html-video-*.test.ts
```

Run local production E2E where environment is available:

```bash
QIVANCE_CODEX_IMAGE_GEN_CMD=/home/jym/workspace/qivance-music/scripts/codex-image-gen-parent-wrapper.ts \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome \
node --experimental-strip-types scripts/e2e-product-v3.ts --primary

QIVANCE_CODEX_IMAGE_GEN_CMD=/home/jym/workspace/qivance-music/scripts/codex-image-gen-parent-wrapper.ts \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome \
node --experimental-strip-types scripts/e2e-media-v3-regression.ts --all
```

### Final Acceptance

- Focused tests pass.
- Typecheck passes.
- Primary-ratio product E2E passes without fallback frames.
- Three-ratio production-strict media/export regression passes.
- `docs/TEST_REPORT.v3.md` and traceability matrix are updated.

---

## Self-Review

Before implementation is considered complete:

- Confirm no source code introduced a DB dependency.
- Confirm no frontend build stack was added.
- Confirm source video mode rejects remote URL inputs.
- Confirm LLM prompt assistance is not implemented in V3 P0.
- Confirm html-video Studio is not exposed as production UI.
- Confirm diagnostic fallback cannot satisfy production success.
- Confirm new APIs are future-compatible with a later OpenDesign/Next.js rewrite.
