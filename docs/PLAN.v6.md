# PLAN.v6：video_chain Product Entry, html-video Preview Revision, And Explicit Final Export

> **Source PRD:** `docs/qivance_music_html_video_integration_prd.v6.md`
> **Source SPEC:** `docs/SPEC.v6.md`
> **Status:** Draft
> **Tech stack:** TypeScript, Node HTTP server, Prisma, SQLite, existing V5 control plane, V5 server runner, V3/V4 html-video modules, ffmpeg/ffprobe, Python/WhisperX/audio tooling where available.

---

## 0. Implementation Rules

- Enable `video_chain` as a first-class chain.
- Keep `chat_dialogue_mv` behavior compatible.
- Do not store media blobs in SQLite.
- Treat MP3/WAV as final/master audio.
- Treat MP4 as visual-only background video.
- Allow MP4 without an audio stream for `background_video_only`.
- Generate `section_map.json` through the existing timing pipeline.
- Use real html-video agent/runtime for production frame generation.
- Require every video_chain frame to reference the locked MP4 background path.
- LLM revision refreshes preview only.
- `final.mp4` is regenerated only by explicit export.
- Keep V6 Workbench minimal and internal.

---

## 1. File Structure

### Create

```text
docs/qivance_music_html_video_integration_prd.v6.md
docs/SPEC.v6.md
docs/PLAN.v6.md

src/lib/video-chain/video-chain-runner.ts

tests/video-chain-runner.test.ts
```

### Modify

```text
.trellis/spec/backend/v5-control-plane-runner-contracts.md
src/lib/chain-registry/chain-registry.ts
src/lib/project-core/project-create-v5.ts
src/lib/project-core/project-inputs-v5.ts
src/lib/scheduler/db-run-store.ts
src/lib/scheduler/v5-task-handlers.ts
src/lib/video-html/source-video-import.ts
src/lib/workbench/workbench-html.ts
src/server.ts
tests/chain-registry-v5.test.ts
tests/project-create-v5.test.ts
tests/project-inputs-v5.test.ts
tests/source-video-import.test.ts
tests/workbench-html.test.ts
tests/workbench-v5-api.test.ts
```

---

## Task 1: Enable video_chain In Registry

### Goal

Allow project creation and scheduler task generation for `video_chain`.

### Implement

- Add `video_chain` to enabled chain IDs.
- Extend input kinds with `video`.
- Add V6 stages:
  - `prepare_video_context`
  - `build_video_frames`
  - `render_video_visual`
  - `mux_video_final`
  - `video_qa_report`
  - `write_video_manifest`
- Add chain-scoped output artifacts under `data/chains/video_chain/**` and `exports/video_chain/**`.

### Tests

```bash
node --experimental-strip-types --test tests/chain-registry-v5.test.ts
```

### Acceptance

- `listEnabledV5Chains()` includes `chat_dialogue_mv` and `video_chain`.
- `video_chain` requires lyrics/audio/video.
- Task seeds are deterministic and dependency ordered.

---

## Task 2: Extend Project Creation And Inputs

### Goal

Support V6 project layout and MP4 input upload through the existing DB-backed control plane.

### Implement

- Create `inputs/video`, `data/source`, `data/chains/video_chain`, and `exports/video_chain`.
- Accept `video_file` and `mp4_file` multipart fields.
- Store immutable uploads under `inputs/video/**`.
- Materialize `source_video.mp4` on confirm.
- Require lyrics/audio/video before confirming a `video_chain` project.
- Call source video import with `audioPolicy: background_video_only`.

### Tests

```bash
node --experimental-strip-types --test tests/project-create-v5.test.ts
node --experimental-strip-types --test tests/project-inputs-v5.test.ts
node --experimental-strip-types --test tests/source-video-import.test.ts
```

### Acceptance

- Partial uploads leave status `input_required`.
- Complete lyrics/audio/video upload sets status `input_uploaded`.
- Confirm without video returns `inputs_incomplete`.
- Silent MP4 probes are valid for background-video policy.

---

## Task 3: Implement video-chain Runner

### Goal

Bridge V5 runner tasks to V3/V4 html-video source-video production mechanics.

### Implement

- Add `src/lib/video-chain/video-chain-runner.ts`.
- `prepareVideoChainContext`:
  - ensure background video import;
  - read `section_map.json`;
  - build `video_animation_plan.json`.
- `buildVideoChainFrames`:
  - create html-video workspace;
  - write agent context;
  - stage `source_video.mp4`;
  - run html-video agent/runtime;
  - validate frame outputs;
  - validate every frame keeps background MP4.
- `renderVideoChainVisual`:
  - render html-video frames to `exports/video_chain/visual.mp4`.
- `muxVideoChainFinal`:
  - mux `active_music_take.mp3` into `exports/video_chain/final.mp4`.
- `writeVideoChainQaReport`:
  - verify one audio stream and <=150ms duration drift.
- `writeVideoChainManifest`:
  - write schema v6 manifest.

### Tests

```bash
node --experimental-strip-types --test tests/video-chain-runner.test.ts
```

### Acceptance

- Runner creates preview frames with MP4 background.
- Final export uses MP3 as audio source.
- Manifest records `ignore_source_audio` for MP4 background.

---

## Task 4: Wire Scheduler Handlers And Status Sync

### Goal

Execute `video_chain` tasks through the existing server runner loop.

### Implement

- Map V6 stages in `createV5TaskHandlers`.
- Preserve locked input sha validation before final manifest.
- Update project/chain status based on chain IDs present in the run instead of hardcoding `chat_dialogue_mv`.

### Tests

```bash
node --experimental-strip-types --test tests/server-runner-loop-v5.test.ts
node --experimental-strip-types --test tests/chat-dialogue-runner-v5.test.ts
```

### Acceptance

- Missing handler does not block video_chain stages.
- Stopped/failed/passed statuses sync to the correct chain.
- Existing chat chain runner tests continue to pass.

---

## Task 5: Add Workbench Subpage

### Goal

Provide a real-test-ready UI for project inputs, preview, LLM revision, and explicit export.

### Implement

- Add `GET /projects/:id/video-chain`.
- Add `GET /projects/:id/video-chain/preview`.
- Add a V6 link from DB-backed project detail page.
- Add input form with MP4 field.
- Add preview iframe.
- Add LLM Revision panel.
- Add explicit Render final.mp4 button.
- Add final download link.

### Tests

```bash
node --experimental-strip-types --test tests/workbench-html.test.ts
node --experimental-strip-types --test tests/workbench-v5-api.test.ts
```

### Acceptance

- Project list can create `video_chain`.
- `video_chain` detail page links to the subpage.
- Subpage includes upload, status, preview, revision, export, artifacts, and events.

---

## Task 6: Add API Routes

### Goal

Expose chain-scoped V6 preview, revision, explicit export, and final download APIs.

### Implement

```text
GET /api/projects/:id/chains/video-chain/preview
POST /api/projects/:id/chains/video-chain/revise
POST /api/projects/:id/chains/video-chain/export/render
GET /api/projects/:id/chains/video-chain/export/final.mp4
```

### Acceptance

- Preview returns html-video preview model.
- Revision returns refreshed preview and `export_policy: preview_refreshed_only`.
- Revision failure marks invalid preview with `video_chain_preview_invalid`.
- Export returns visual/final/QA/manifest refs.

---

## Task 7: Regression And Spec Sync

### Goal

Prove V6 did not regress V3/V4/V5 contracts and preserve the new V6 contract for future work.

### Implement

- Update backend Trellis spec for V6.
- Add docs PRD/SPEC/PLAN v6.
- Update tests for registry, project creation, input upload, source-video import, Workbench HTML/API, and runner.
- Run focused V5/V6 and V4 overlap tests.

### Required Checks

```bash
npm run typecheck

TMPDIR=/tmp node --experimental-strip-types --test \
  tests/prisma-control-plane.test.ts \
  tests/chain-registry-v5.test.ts \
  tests/project-create-v5.test.ts \
  tests/project-inputs-v5.test.ts \
  tests/server-runner-loop-v5.test.ts \
  tests/timing-pipeline-v5.test.ts \
  tests/chat-dialogue-runner-v5.test.ts \
  tests/workbench-html.test.ts \
  tests/source-video-import.test.ts \
  tests/video-chain-runner.test.ts

TMPDIR=/tmp node --experimental-strip-types --test tests/workbench-v5-api.test.ts
TMPDIR=/tmp npm test
TMPDIR=/tmp node --experimental-strip-types --test tests/chat-chain-api.test.ts
TMPDIR=/tmp node --experimental-strip-types --test tests/workbench-api.test.ts
TMPDIR=/tmp node --experimental-strip-types --test tests/workbench-scheduler-html.test.ts
git diff --check
npx gitnexus analyze --index-only --name qivance-music
npx gitnexus detect-changes --repo qivance-music
```

### Acceptance

- Typecheck passes.
- Focused V5/V6 tests pass.
- html-video tests pass.
- V4 chat/scheduler overlap tests pass.
- GitNexus `critical` risk is documented as intentional cross-layer scope.
