# TEST_REPORT v4

Date: 2026-06-15
Branch: `codex/v4-plan`
Latest implementation commit: not committed yet

Sources:
- PRD: `docs/qivance_music_html_video_integration_prd.v4.md`
- Chat-chain PRD: `docs/qivance_music_chat_dialogue_mv_chain_prd.md`
- SPEC: `docs/SPEC.v4.md`
- PLAN: `docs/PLAN.v4.md`

## Summary

V4 adds a file-backed scheduler model for multi-project and multi-chain planning, resource locks, run queue state, resume/cancel/status APIs, Workbench scheduler visibility, and a P0 `chat_dialogue_mv` chain contract.

The implementation now covers scheduler task modeling, execution-plan building, fair ready selection, resource locks, recovery, scheduler execution ticks, project-scoped chain APIs, global scheduler APIs, chat dialogue structured artifacts, render manifest v4 validation, Workbench summaries, and E2E scripts.

The chat-dialogue E2E script writes local HTML chat frames, captures them with headless Chrome, renders `exports/chat_dialogue_mv/visual.mp4` with ffmpeg, muxes locked master audio, and validates final MP4 audio stream count and duration drift with ffprobe.

## Implementation Evidence

| Area | Status | Evidence |
|---|---|---|
| Scheduler types/config/events | Implemented | `src/lib/scheduler/scheduler-types.ts`; `src/lib/scheduler/scheduler-config.ts`; `src/lib/scheduler/scheduler-events.ts`; `tests/scheduler-task-model.test.ts` |
| Execution plan builder | Implemented | `src/lib/scheduler/execution-plan.ts`; `tests/scheduler-execution-plan.test.ts` |
| Resource locks | Implemented | `src/lib/scheduler/resource-locks.ts`; `tests/scheduler-resource-locks.test.ts` |
| Run queue and fair scheduling | Implemented | `src/lib/scheduler/run-queue.ts`; `tests/scheduler-run-queue.test.ts` |
| Resume/cancel/status/execution tick | Implemented | `src/lib/scheduler/scheduler-runner.ts`; `src/lib/scheduler/scheduler-status.ts`; `tests/scheduler-recovery.test.ts`; `tests/scheduler-runner.test.ts` |
| Chat dialogue chain contracts/rendering | Implemented | `src/lib/chat-dialogue/*`; `tests/chat-*.test.ts`; `tests/chat-frame-renderer.test.ts` |
| Chain and scheduler APIs | Implemented | `src/server.ts`; `tests/chat-chain-api.test.ts` |
| Workbench scheduler/chain UI | Implemented | `src/lib/workbench/workbench-html.ts`; `tests/workbench-scheduler-html.test.ts` |
| Render manifest v4 | Implemented | `src/lib/export/render-manifest-v4.ts`; `tests/render-manifest-v4.test.ts` |
| Scheduler E2E | Passed | `scripts/e2e-scheduler-v4.ts`; `/home/jym/workspace/qivance-music/projects/v4_scheduler_20260615174736` |
| Chat dialogue E2E | Passed | `scripts/e2e-chat-dialogue-v4.ts`; `/home/jym/workspace/qivance-music/projects/v4_chat_dialogue_20260615174750/chat_dialogue_v4_fixture` |

## Verification Run In This Session

```bash
TMPDIR=/tmp node --experimental-strip-types --test tests/scheduler-task-model.test.ts tests/scheduler-execution-plan.test.ts tests/scheduler-resource-locks.test.ts tests/scheduler-run-queue.test.ts tests/scheduler-recovery.test.ts tests/scheduler-runner.test.ts tests/chat-lyrics-line-map.test.ts tests/chat-speaker-attribution.test.ts tests/chat-conversation-plan.test.ts tests/chat-animation-plan.test.ts tests/chat-frame-contracts.test.ts tests/chat-frame-renderer.test.ts tests/render-manifest-v4.test.ts tests/workbench-scheduler-html.test.ts
```

Result: passed, 14 tests.

```bash
TMPDIR=/tmp node --experimental-strip-types --test tests/chat-chain-api.test.ts
```

Result: passed, 2 tests. This test requires local `127.0.0.1` port listening and was run with sandbox escalation.

```bash
npm run typecheck
```

Result: passed.

```bash
TMPDIR=/tmp node --experimental-strip-types --test tests/html-video-agent-production-gate.test.ts tests/html-video-agent-runtime.test.ts tests/html-video-codex-agent.test.ts tests/html-video-contract.test.ts tests/html-video-frame-output-validator.test.ts tests/html-video-import-smoke.test.ts tests/html-video-preview-export.test.ts tests/html-video-strict-render.test.ts tests/html-video-workflow.test.ts tests/html-video-workspace.test.ts
```

Result: passed, 10 tests.

```bash
TMPDIR=/tmp node --experimental-strip-types --test tests/html-video-server.test.ts
```

Result: passed, 1 test. This test requires local `127.0.0.1` port listening and was run with sandbox escalation.

```bash
TMPDIR=/tmp node --experimental-strip-types scripts/e2e-scheduler-v4.ts --scheduler-smoke
```

Result: passed.

Artifacts:
- Storage root: `/home/jym/workspace/qivance-music/projects/v4_scheduler_20260615174736`
- Run id: `run_scheduler_v4_20260615174736`
- Projects: `scheduler_project_a`, `scheduler_project_b`
- Chains: `chat_dialogue_mv`, `image_storyboard_mv`
- Evidence: timing writer count was 2, ready queue selected both projects, scheduler tick executed 2 ready tasks, chromium render lock limited concurrent render, resume requeued `task_scheduler_project_a_chat_dialogue_mv_render_visual`.

```bash
TMPDIR=/tmp node --experimental-strip-types scripts/e2e-chat-dialogue-v4.ts --production
```

Result: passed.

Artifacts:
- Project root: `/home/jym/workspace/qivance-music/projects/v4_chat_dialogue_20260615174750/chat_dialogue_v4_fixture`
- Final MP4: `/home/jym/workspace/qivance-music/projects/v4_chat_dialogue_20260615174750/chat_dialogue_v4_fixture/exports/chat_dialogue_mv/final.mp4`
- Render manifest: `/home/jym/workspace/qivance-music/projects/v4_chat_dialogue_20260615174750/chat_dialogue_v4_fixture/exports/chat_dialogue_mv/render_manifest.json`
- QA report: `/home/jym/workspace/qivance-music/projects/v4_chat_dialogue_20260615174750/chat_dialogue_v4_fixture/data/chains/chat_dialogue_mv/qa_report.json`
- QA result: one audio stream, duration drift 46ms, rendered frames 2.

## Repro Commands

Scheduler smoke:

```bash
TMPDIR=/tmp \
node --experimental-strip-types scripts/e2e-scheduler-v4.ts --scheduler-smoke
```

Expected artifacts:
- `projects/v4_scheduler_<timestamp>/scheduler/run_queue.json`
- `projects/v4_scheduler_<timestamp>/scheduler/scheduler_config.json`
- `projects/v4_scheduler_<timestamp>/scheduler/project_runs/<run_id>.json`
- `projects/v4_scheduler_<timestamp>/<project_id>/data/scheduler/execution_plan.json`

Chat-dialogue smoke:

```bash
TMPDIR=/tmp \
node --experimental-strip-types scripts/e2e-chat-dialogue-v4.ts --production
```

Expected artifacts:
- `projects/v4_chat_dialogue_<timestamp>/chat_dialogue_v4_fixture/data/chains/chat_dialogue_mv/lyrics_line_map.json`
- `projects/v4_chat_dialogue_<timestamp>/chat_dialogue_v4_fixture/data/chains/chat_dialogue_mv/speaker_attribution.json`
- `projects/v4_chat_dialogue_<timestamp>/chat_dialogue_v4_fixture/data/chains/chat_dialogue_mv/conversation_plan.json`
- `projects/v4_chat_dialogue_<timestamp>/chat_dialogue_v4_fixture/data/chains/chat_dialogue_mv/frame_contracts.json`
- `projects/v4_chat_dialogue_<timestamp>/chat_dialogue_v4_fixture/data/chains/chat_dialogue_mv/qa_report.json`
- `projects/v4_chat_dialogue_<timestamp>/chat_dialogue_v4_fixture/exports/chat_dialogue_mv/render_manifest.json`
- `projects/v4_chat_dialogue_<timestamp>/chat_dialogue_v4_fixture/exports/chat_dialogue_mv/final.mp4`

## Remaining Gaps

- The scheduler has a local execution tick with injected task handlers, not a persistent daemon or distributed worker. This matches the V4 non-goal of no distributed worker system.
- V3 production-strict media regression was not rerun in this V4 session because it invokes live image generation and long html-video agent runs. Existing html-video coverage was rerun and passed.
- No database-backed scheduler persistence, SaaS permissions, or upstream content generation was added; V4 stays file-backed.
