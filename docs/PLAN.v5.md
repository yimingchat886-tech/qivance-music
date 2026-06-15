# PLAN.v5：Product Entry, SQLite Control Plane, And Server Runner Loop

> **Source PRD:** `docs/qivance_music_html_video_integration_prd.v5.md`
> **Source SPEC:** `docs/SPEC.v5.md`
> **Status:** Draft
> **Tech stack:** TypeScript, Node HTTP server, Prisma, SQLite, existing file-system project model, V4 scheduler/chat-dialogue modules, ffmpeg/ffprobe, Python/WhisperX/audio tooling where available.

---

## 0. Implementation Rules

- Use SQLite + Prisma for the V5 control plane.
- Do not store media blobs in SQLite. Lyrics/audio/media artifacts remain project files.
- Keep V2-V4 stable paths: `lyrics.md`, `active_music_take.mp3`, `data/timing/**`, `exports/chat_dialogue_mv/**`.
- Do not start scheduler work before explicit input confirmation.
- Allow replacement only with explicit `replace=true` and only outside `input_confirmed/queued/running/stopping`.
- Validate inputs on upload and validate locked input sha again in final manifest.
- Run production timing automatically after confirmation.
- Preserve V4 production-strict behavior. Diagnostic fallback cannot satisfy V5 success.
- Use server built-in runner loop, not a new external daemon, Redis, BullMQ, or distributed worker.
- Keep Workbench minimal and internal. Do not add login, SaaS, permissions, Cloudflare Access, Tailscale, or a frontend rewrite.
- P0 chain registry enables only `chat_dialogue_mv`.
- Do not implement `image_storyboard_mv`; it is removed from the product route.
- Do not implement `video_chain`; it is next-version direction only.

---

## 1. File Structure

### Create

```text
docs/TEST_REPORT.v5.md

prisma/schema.prisma
prisma/migrations/**

src/lib/db/prisma-client.ts
src/lib/db/control-plane.ts

src/lib/project-core/project-create-v5.ts
src/lib/project-core/project-inputs-v5.ts
src/lib/project-core/project-artifacts-v5.ts

src/lib/chain-registry/chain-registry.ts

src/lib/scheduler/db-run-store.ts
src/lib/scheduler/server-runner-loop.ts
src/lib/scheduler/v5-task-handlers.ts

tests/prisma-control-plane.test.ts
tests/project-create-v5.test.ts
tests/project-inputs-v5.test.ts
tests/chain-registry-v5.test.ts
tests/server-runner-loop-v5.test.ts
tests/timing-pipeline-v5.test.ts
tests/chat-dialogue-runner-v5.test.ts
tests/workbench-v5-html.test.ts
tests/workbench-v5-api.test.ts

scripts/e2e-v5-product-entry.ts
```

### Modify

```text
package.json
pnpm-lock.yaml
src/server.ts
src/lib/project-core/paths.ts
src/lib/scheduler/scheduler-runner.ts
src/lib/scheduler/resource-locks.ts
src/lib/workbench/project-status.ts
src/lib/workbench/workbench-html.ts
src/lib/workbench/api-types.ts
src/lib/export/render-manifest-v4.ts
docs/requirements traceability matrix.md
```

Exact file names may be adjusted during implementation if existing modules provide a better home, but the responsibilities must remain close to the SPEC boundaries.

---

## Task 1: Prisma Schema And SQLite Init

### Goal

Add the V5 SQLite + Prisma control plane without changing media/artifact storage.

### Implement

- Add Prisma dependencies and scripts needed for schema generation and SQLite migrations.
- Add `prisma/schema.prisma` with Project, ProjectInput, Artifact, Chain, SchedulerRun, SchedulerTask, and SchedulerEvent models.
- Resolve the SQLite file under the configured storage root as `qivance_control.sqlite`.
- Add a Prisma client lifecycle helper for the Node server and tests.
- Add repository helpers for create/read/update operations used by V5 APIs and runner.
- Keep `qivance_audio.sqlite` separate; do not reuse it as the control plane.

### Tests

```bash
node --experimental-strip-types --test tests/prisma-control-plane.test.ts
```

### Acceptance

- A fresh storage root creates the SQLite control-plane database.
- All required models can be inserted and queried.
- DB rows store only metadata and paths, not media blobs.
- The Prisma client can be cleanly closed in tests and server shutdown paths.

---

## Task 2: DB-Backed Project Create/List/Detail

### Goal

Make project creation a product entrypoint instead of requiring pre-existing fixtures.

### Implement

- Add `POST /api/projects` for V5 project creation.
- Accept `title`, `content_type`, and optional `description`.
- Validate `content_type` through the chain registry.
- Create a Project row with status `input_required`.
- Create the project root and initial folders.
- Create a Chain row for `chat_dialogue_mv`.
- Update `GET /api/projects` and `GET /api/projects/:id` to include DB-backed projects while preserving existing file-backed project visibility where needed.
- Do not create a SchedulerRun during project creation.

### Tests

```bash
node --experimental-strip-types --test tests/project-create-v5.test.ts
node --experimental-strip-types --test tests/workbench-v5-api.test.ts
```

### Acceptance

- Creating a project returns `project_id`, `input_required`, and `chat_dialogue_mv`.
- Unknown or disabled `content_type` is rejected.
- The project appears in project list/detail APIs.
- No scheduler run exists before inputs are confirmed.

---

## Task 3: Input Upload, Confirm Inputs, And Stable Paths

### Goal

Support uploading/pasting lyrics and uploading audio, then locking inputs only after explicit confirmation.

### Implement

- Add `POST /api/projects/:id/inputs`.
- Support multipart `lyrics_text`, `lyrics_file`, `audio_file`, and `replace=true`.
- Accept `.md` / `.txt` lyrics and `.mp3` / `.wav` audio.
- Write immutable input files under `inputs/lyrics/**` and `inputs/audio/**`.
- Compute sha256 and write ProjectInput rows.
- Update project status to `input_uploaded` only when active lyrics and audio both exist.
- Add `POST /api/projects/:id/inputs/confirm`.
- On confirm, materialize `lyrics.md` and `active_music_take.mp3`.
- Create SchedulerRun and SchedulerTask rows from the registry.
- Reject confirm when a queued/running/stopping run already exists.
- Implement explicit replacement rules and stale Artifact marking.

### Tests

```bash
node --experimental-strip-types --test tests/project-inputs-v5.test.ts
node --experimental-strip-types --test tests/workbench-v5-api.test.ts
```

### Acceptance

- Partial uploads are allowed.
- Scheduler does not start before confirm.
- Confirm requires both active lyrics and active audio.
- Running projects reject replacement.
- `replace=true` after stopped/failed/passed supersedes old inputs and marks downstream artifacts stale.

---

## Task 4: Chain Registry P0

### Goal

Introduce an extensible chain registry while enabling only `chat_dialogue_mv` for V5.

### Implement

- Add a registry module with `chat_dialogue_mv` entry.
- Define input requirements, timing requirement, stages, resource requirements, and output artifacts.
- Use registry validation in project creation and confirm-input task generation.
- Ensure `image_storyboard_mv` is not registered as enabled or planned.
- Ensure `video_chain` is not executable in V5.

### Tests

```bash
node --experimental-strip-types --test tests/chain-registry-v5.test.ts
```

### Acceptance

- `chat_dialogue_mv` is the only enabled chain.
- Unknown, disabled, `image_storyboard_mv`, and `video_chain` chain IDs are rejected.
- Registry stages generate the expected V5 SchedulerTask rows.

---

## Task 5: Server Runner Loop And Graceful Stop

### Goal

Move execution from manual/local ticks to a server-owned loop with stop and recovery semantics.

### Implement

- Start the runner loop after server storage root and DB initialization.
- Scan queued runs and ready tasks on an interval.
- Claim tasks atomically to avoid duplicate execution.
- Use resource locks before running task handlers.
- Persist SchedulerTask status transitions and SchedulerEvent rows.
- Implement recovery for queued and running-stale runs after server restart.
- Add `POST /api/projects/:id/runs/:runId/stop`.
- On stop, set `stop_requested`, let the current task finish, and mark unstarted tasks `stopped`.
- Do not start new tasks for stopping runs.

### Tests

```bash
node --experimental-strip-types --test tests/server-runner-loop-v5.test.ts
```

### Acceptance

- Queued tasks execute without manually calling a scheduler tick route.
- A running task is not duplicated by another loop iteration.
- Graceful stop does not kill the current task and starts no next task.
- Restart recovery handles queued and running-stale runs.

---

## Task 6: Timing Pipeline Task Handlers

### Goal

Automatically produce the timing bundle after input confirmation.

### Implement

- Add V5 task handlers for audio analysis, word alignment, quality gate, and section map output.
- Reuse existing audio-analysis, word-alignment, and section-map modules where possible.
- Write required artifacts under `data/timing/**`.
- Write Artifact rows with sha256 for each timing output.
- Distinguish `timing_blocked` from `timing_failed`.
- Keep diagnostic fallback explicit and excluded from production success.

### Tests

```bash
node --experimental-strip-types --test tests/timing-pipeline-v5.test.ts
```

### Acceptance

- Confirmed project automatically receives timing tasks.
- Successful timing writes all six required timing artifacts.
- Missing local dependencies produce `timing_blocked`.
- Analysis or quality failures produce `timing_failed`.

---

## Task 7: chat_dialogue_mv Task Handlers

### Goal

Run the V4 chat dialogue chain through V5 DB-backed tasks.

### Implement

- Wrap existing `src/lib/chat-dialogue/**` builders as runner task handlers.
- Generate lyrics line map, speaker attribution, conversation plan, animation plan, frame contracts, frames, visual render, mux, QA, and manifest.
- Write Artifact rows for produced JSON, frame, visual, final, QA, and manifest outputs.
- Mark Chain metrics and last_error in DB.
- Final manifest must validate locked input sha against ProjectInput rows.
- Keep output under `exports/chat_dialogue_mv/**`.

### Tests

```bash
node --experimental-strip-types --test tests/chat-dialogue-runner-v5.test.ts
node --experimental-strip-types --test tests/render-manifest-v4.test.ts
```

### Acceptance

- V5 runner can execute the chat chain without calling the old manual chain endpoints.
- Final MP4, manifest, and QA report are produced.
- Manifest validation fails if locked input sha does not match DB.
- Existing V4 manifest behavior remains compatible.

---

## Task 8: Minimal Workbench V5 UI

### Goal

Expose the V5 internal workflow without adding a new frontend stack.

### Implement

- Extend the Node-served Workbench project list with DB-backed V5 projects.
- Add a new project form.
- Add lyrics paste/file upload and audio upload controls.
- Show input sha, original filename, mime, and status.
- Add Confirm inputs action.
- Add run/task/event status views.
- Add graceful stop action.
- Add final MP4, render manifest, and QA report links.
- Show timing/render/manifest errors clearly.
- Do not add auth, permissions, SaaS settings, tenant UI, or template marketplace UI.

### Tests

```bash
node --experimental-strip-types --test tests/workbench-v5-html.test.ts
node --experimental-strip-types --test tests/workbench-v5-api.test.ts
```

### Acceptance

- A user can complete create -> upload -> confirm from Workbench.
- Workbench shows run/task/event progress and failure reasons.
- Workbench exposes stop and final download when available.
- No login/SaaS/permission controls are introduced.

---

## Task 9: V5 Product Entry E2E

### Goal

Verify the full internal product path from Workbench/API entry to final MP4.

### Implement

- Add `scripts/e2e-v5-product-entry.ts`.
- Use a temporary storage root.
- Create a project through API.
- Upload lyrics and audio through API.
- Confirm inputs.
- Wait for runner loop to finish.
- Verify timing artifacts, chat artifacts, final MP4, QA report, manifest, and DB rows.
- Include a graceful stop scenario and a post-stop `replace=true` scenario.

### Tests

```bash
node --experimental-strip-types scripts/e2e-v5-product-entry.ts
```

### Acceptance

- The happy path completes without manual scheduler tick calls.
- Final manifest validates locked input sha.
- Graceful stop leaves already produced artifacts intact.
- `replace=true` after stop creates a new run and marks previous artifacts stale.

---

## Task 10: TEST_REPORT.v5 And Traceability

### Goal

Record V5 evidence without overwriting V2-V4 acceptance.

### Implement

- Add `docs/TEST_REPORT.v5.md`.
- Record focused unit tests, Workbench API/HTML tests, and V5 E2E output paths.
- Update `docs/requirements traceability matrix.md` V5 Addendum from planning status to implemented status as tasks land.
- Record any skipped live dependency checks and exact reasons.

### Tests

```bash
git diff --check -- docs/TEST_REPORT.v5.md "docs/requirements traceability matrix.md"
```

### Acceptance

- V5 evidence is separate from V2-V4 reports.
- Traceability rows point to V5 implementation and report evidence.
- Remaining non-goals are still marked as delayed or canceled, not failed V5 work.
