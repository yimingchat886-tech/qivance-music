# V4 Chat Dialogue And Scheduler Contracts

## Scenario: V4 Chat Dialogue Chain And File-Backed Scheduler

### 1. Scope / Trigger

- Trigger: V4 adds cross-layer APIs, scheduler state files, chain artifacts, Workbench summaries, and render/export evidence.
- Applies when changing `src/server.ts`, `src/lib/scheduler/**`, `src/lib/chat-dialogue/**`, `src/lib/export/render-manifest-v4.ts`, or V4 E2E scripts.

### 2. Signatures

- `GET /api/projects/:id/chains`
- `GET /api/projects/:id/chains/chat-dialogue-mv/status`
- `POST /api/projects/:id/chains/chat-dialogue-mv/run`
- `POST /api/projects/:id/chains/chat-dialogue-mv/build-conversation-plan`
- `POST /api/projects/:id/chains/chat-dialogue-mv/build-frames`
- `GET /api/projects/:id/chains/chat-dialogue-mv/preview`
- `POST /api/projects/:id/chains/chat-dialogue-mv/revise`
- `POST /api/projects/:id/chains/chat-dialogue-mv/export/render`
- `GET /api/projects/:id/chains/chat-dialogue-mv/export/final.mp4`
- `GET /api/scheduler/status`
- `GET /api/scheduler/runs`
- `POST /api/scheduler/runs`
- `GET /api/scheduler/runs/:runId`
- `POST /api/scheduler/runs/:runId/cancel`

### 3. Contracts

- Chain id is always `chat_dialogue_mv`.
- Chain artifacts stay under `data/chains/chat_dialogue_mv/**`.
- Chain exports stay under `exports/chat_dialogue_mv/**`.
- Chat HTML frames stay under `video/html-video/.html-video/projects/<project_id>/frames/**`.
- Scheduler coordination state stays under `scheduler/**` and `projects/<project_id>/data/scheduler/**`.
- Scheduler state does not replace project artifact validation; project artifacts remain the acceptance source.
- Production export must write:
  - `exports/chat_dialogue_mv/visual.mp4`
  - `exports/chat_dialogue_mv/final.mp4`
  - `exports/chat_dialogue_mv/render_manifest.json`
  - `data/chains/chat_dialogue_mv/qa_report.json`
- `render_manifest.json` uses schema version `4`, records input/output sha evidence, and rejects diagnostic/fallback success in production.
- `qa_report.json` records ffprobe evidence, exactly one audio stream, duration drift, and frame render evidence.

### 4. Validation & Error Matrix

- Missing `lyrics.md` -> chain status includes `lyrics_missing`.
- Missing active audio -> chain status includes `audio_missing`.
- Missing timing bundle -> chain status includes `timing_missing`.
- Missing `conversation_plan.json` before frame build/export -> `409 conversation_plan_missing`.
- Missing `frame_contracts.json` before preview/export -> `409 frame_contracts_missing`.
- Invalid chain revision request without `request` -> `400 invalid_chat_revision_request`.
- Final MP4 with audio stream count not equal to 1 -> `409 chat_export_audio_stream_invalid`.
- Final MP4 duration drift over 150ms -> `409 chat_export_duration_drift`.
- Invalid scheduler request body -> `400 invalid_scheduler_run_request`.
- Missing scheduler project -> `404 scheduler_project_invalid`.
- Missing scheduler run -> `404 scheduler_run_not_found`.

### 5. Good/Base/Bad Cases

- Good: project has `lyrics.md`, locked audio, timing bundle, builds conversation plan, builds frames, renders visual, muxes final audio, writes v4 manifest and QA.
- Base: project is input-ready but has no chain artifacts; `/run` creates scheduler plan and status exposes ready/blocked counts.
- Bad: export tries to use diagnostic or fallback success as production success; manifest validation must reject it.

### 6. Tests Required

- Scheduler model/config/plan/queue/locks/recovery/tick:
  - `tests/scheduler-task-model.test.ts`
  - `tests/scheduler-execution-plan.test.ts`
  - `tests/scheduler-resource-locks.test.ts`
  - `tests/scheduler-run-queue.test.ts`
  - `tests/scheduler-recovery.test.ts`
  - `tests/scheduler-runner.test.ts`
- Chat chain contracts/rendering:
  - `tests/chat-lyrics-line-map.test.ts`
  - `tests/chat-speaker-attribution.test.ts`
  - `tests/chat-conversation-plan.test.ts`
  - `tests/chat-animation-plan.test.ts`
  - `tests/chat-frame-contracts.test.ts`
  - `tests/chat-frame-renderer.test.ts`
- API/export/workbench:
  - `tests/chat-chain-api.test.ts`
  - `tests/render-manifest-v4.test.ts`
  - `tests/workbench-scheduler-html.test.ts`
- E2E:
  - `scripts/e2e-scheduler-v4.ts --scheduler-smoke`
  - `scripts/e2e-chat-dialogue-v4.ts --production`

### 7. Wrong vs Correct

#### Wrong

- Write chat export files to shared `exports/final.mp4`.
- Treat scheduler `run_queue.json` as proof that artifacts are valid.
- Render a placeholder MP4 and call it production success.
- Let multiple heavy tasks bypass resource locks.

#### Correct

- Write chat export files only under `exports/chat_dialogue_mv/**`.
- Validate project artifacts and render manifest before reporting success.
- Render local HTML chat frames to `visual.mp4`, mux locked audio to `final.mp4`, and record ffprobe QA.
- Acquire resource locks before running scheduler tasks, write task events, and release locks after pass/fail.
