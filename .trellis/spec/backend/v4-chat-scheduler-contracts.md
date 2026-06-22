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
- Optional chat UI profile input stays at `data/chains/chat_dialogue_mv/chat_ui_profile.json` and may set local-only `contact_name`, `contact_status`, `contact_avatar_src`, `left_avatar_src`, and `right_avatar_src` before `conversation_plan.json` is written.
- Chain exports stay under `exports/chat_dialogue_mv/**`.
- Runtime chat HTML stays under `video/html-video/.html-video/projects/<project_id>/runtime/chat_dialogue_mv.html`.
- Runtime chat HTML generation must copy every referenced packaged local asset under `video/html-video/.html-video/projects/<project_id>/assets/**`; broken local images are a render bug, not an acceptable fallback.
- Production visual rendering uses browser recording:
  - `runtime_timeline.json` is the source of truth for browser playback state.
  - JS schedules absolute `at_sec` events from `runtime_timeline.json` and toggles classes only.
  - CSS owns bubble pop, read receipt, avatar, and header typing motion using `transform`, `opacity`, and `visibility`.
  - Browser recording captures the runtime page at 60fps and writes `exports/chat_dialogue_mv/visual.mp4`.
  - Browser recording must fail with a bounded error if CDP virtual-time frame advancement or screenshot capture stalls; it must not leave a task waiting indefinitely without growing frame output.
  - `browser_render_evidence.json` records fps, frame count, runtime HTML path, output path, and visual sha.
- Static chat HTML frames stay under `video/html-video/.html-video/projects/<project_id>/frames/**` only when fallback/debug mode is explicitly enabled.
- `frame_contracts.json` is fallback/debug static screenshot UI state only:
  - `scroll_windows` stay logical and only decide `visible_message_ids`.
  - each frame carries `ui_state.header.phase`, optional `entering_message_id` / `enter_progress`, and optional `read_receipt`.
  - CSS pop, read receipt, and header typing motion are driven by explicit frame progress and paused CSS keyframes, not JS timelines or Chrome virtual time.
  - right-side read receipts target only the nearest right/questioner message that is followed by a left reply; the receipt avatar uses the left avatar image (`../assets/avatars/1.jpg` by default).
- Scheduler coordination state stays under `scheduler/**` and `projects/<project_id>/data/scheduler/**`.
- Scheduler state does not replace project artifact validation; project artifacts remain the acceptance source.
- Production export must write:
  - `exports/chat_dialogue_mv/visual.mp4`
  - `exports/chat_dialogue_mv/final.mp4`
  - `exports/chat_dialogue_mv/render_manifest.json`
  - `data/chains/chat_dialogue_mv/qa_report.json`
- `render_manifest.json` uses schema version `4`, records runtime timeline/html/browser render evidence for browser recording, records `frame_contracts` only for static fallback/debug, and rejects diagnostic/fallback success in production.
- `qa_report.json` records ffprobe evidence, exactly one audio stream, duration drift, and frame render evidence.

### 4. Validation & Error Matrix

- Missing `lyrics.md` -> chain status includes `lyrics_missing`.
- Missing active audio -> chain status includes `audio_missing`.
- Missing timing bundle -> chain status includes `timing_missing`.
- Missing `conversation_plan.json` before frame build/export -> `409 conversation_plan_missing`.
- Invalid `chat_ui_profile.json` object, field type, or remote avatar URL -> conversation plan build fails before render artifacts are written.
- Missing `runtime_timeline.json` before browser recording export -> `409 runtime_timeline_missing`.
- Missing `frame_contracts.json` before static fallback preview/export -> `409 frame_contracts_missing`.
- Invalid chain revision request without `request` -> `400 invalid_chat_revision_request`.
- Final MP4 with audio stream count not equal to 1 -> `409 chat_export_audio_stream_invalid`.
- Final MP4 duration drift over 150ms -> `409 chat_export_duration_drift`.
- Invalid scheduler request body -> `400 invalid_scheduler_run_request`.
- Missing scheduler project -> `404 scheduler_project_invalid`.
- Missing scheduler run -> `404 scheduler_run_not_found`.

### 5. Good/Base/Bad Cases

- Good: project has `lyrics.md`, locked audio, timing bundle, builds conversation plan, builds runtime timeline and runtime HTML, records browser-rendered visual MP4, muxes final audio, writes v4 manifest and QA.
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
    - assert optional `chat_ui_profile.json` overrides the single header/contact profile and missing profile preserves defaults
  - `tests/chat-animation-plan.test.ts`
  - `tests/chat-frame-contracts.test.ts` with assertions for positive frame durations, total duration, `ui_state` progress ranges, receipt target rules, paused CSS keyframes, and receipt avatar source
  - `tests/chat-frame-renderer.test.ts`
  - `tests/chat-runtime-timeline.test.ts`
  - `tests/chat-runtime-html.test.ts`
  - `tests/chat-browser-recorder.test.ts`
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
- Render local runtime chat HTML to `visual.mp4` through browser recording, mux locked audio to `final.mp4`, and record ffprobe QA.
- Acquire resource locks before running scheduler tasks, write task events, and release locks after pass/fail.
