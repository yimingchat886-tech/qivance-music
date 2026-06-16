# TEST_REPORT v5

Date: 2026-06-15
Branch: `codex/planv5-track-trellis-files`
Latest implementation commit: not committed yet

Sources:
- PRD: `docs/qivance_music_html_video_integration_prd.v5.md`
- SPEC: `docs/SPEC.v5.md`
- PLAN: `docs/PLAN.v5.md`
- Traceability: `docs/requirements traceability matrix.md`

## Summary

V5 adds the internal product entry for Qivance Music: DB-backed project creation, lyrics/audio upload, explicit input confirmation, SQLite + Prisma control plane, a server-owned runner loop, strict timing generation, DB-backed `chat_dialogue_mv` task execution, minimal Workbench controls, graceful stop, post-stop replacement, and V5 evidence.

The happy-path V5 E2E completed through the HTTP API and server runner without manual scheduler ticks. It created a project, uploaded lyrics/audio, confirmed inputs, ran audio analysis and WhisperX forced alignment, built chat artifacts, rendered visual/final MP4, wrote QA and render manifest evidence, and verified DB artifact rows.

## Implementation Evidence

| Area | Status | Evidence |
|---|---|---|
| Prisma control plane | Implemented | `prisma/schema.prisma`; `prisma/migrations/20260615000000_v5_control_plane/migration.sql`; `src/lib/db/prisma-client.ts`; `src/lib/db/control-plane.ts`; `tests/prisma-control-plane.test.ts` |
| DB-backed project create/list/detail | Implemented | `src/lib/project-core/project-create-v5.ts`; `src/server.ts`; `tests/project-create-v5.test.ts`; `tests/workbench-v5-api.test.ts` |
| Input upload/confirm/replace | Implemented | `src/lib/project-core/project-inputs-v5.ts`; `tests/project-inputs-v5.test.ts`; `scripts/e2e-v5-product-entry.ts` |
| Chain registry | Implemented | `src/lib/chain-registry/chain-registry.ts`; `tests/chain-registry-v5.test.ts` |
| Server-owned runner loop | Implemented | `src/lib/scheduler/db-run-store.ts`; `src/lib/scheduler/server-runner-loop.ts`; `tests/server-runner-loop-v5.test.ts` |
| Timing pipeline handler | Implemented | `src/lib/scheduler/v5-task-handlers.ts`; `src/lib/word-alignment/whisperx-runner.ts`; `tests/timing-pipeline-v5.test.ts` |
| Chat-dialogue runner handlers | Implemented | `src/lib/scheduler/v5-task-handlers.ts`; `src/lib/chat-dialogue/*`; `tests/chat-dialogue-runner-v5.test.ts` |
| Workbench V5 UI | Implemented | `src/lib/workbench/workbench-html.ts`; `src/lib/workbench/api-types.ts`; `src/lib/workbench/project-status.ts`; `tests/workbench-html.test.ts`; `tests/workbench-v5-api.test.ts` |
| V5 product-entry E2E | Passed | `scripts/e2e-v5-product-entry.ts`; `/tmp/qivance-e2e-v5-Sia6ve/projects` |

## Verification Run In This Session

```bash
TMPDIR=/tmp npm run typecheck
```

Result: passed.

```bash
TMPDIR=/tmp node --experimental-strip-types --test --test-reporter=spec \
  tests/prisma-control-plane.test.ts \
  tests/chain-registry-v5.test.ts \
  tests/project-create-v5.test.ts \
  tests/project-inputs-v5.test.ts \
  tests/server-runner-loop-v5.test.ts \
  tests/timing-pipeline-v5.test.ts \
  tests/chat-dialogue-runner-v5.test.ts \
  tests/chat-conversation-plan.test.ts \
  tests/whisperx-runner.test.ts \
  tests/workbench-html.test.ts \
  tests/workbench-scheduler-html.test.ts
```

Result: passed.

```bash
TMPDIR=/tmp node --experimental-strip-types --test --test-reporter=spec \
  tests/workbench-v5-api.test.ts \
  tests/workbench-api.test.ts
```

Result: passed. These tests require local `127.0.0.1` port listening and were run with sandbox escalation.

```bash
TMPDIR=/tmp node --experimental-strip-types scripts/e2e-v5-product-entry.ts --allow-timing-blocked --timeout-ms 90000
```

Result: passed with real happy-path status `passed`.

Output:

```json
{
  "status": "passed",
  "storage_root": "/tmp/qivance-e2e-v5-Sia6ve/projects",
  "happy_path": {
    "projectId": "project_7b8fe87d0d804902",
    "runId": "run_e3ca21cabb3248b7",
    "status": "passed",
    "lastError": null
  },
  "stop_replace": {
    "project_id": "project_34b39f8656a54cb7",
    "stopped_run_id": "run_2220180b99c84c50",
    "replacement_run_id": "run_d18eea4e66484e4c"
  }
}
```

V5 E2E artifacts:
- Storage root: `/tmp/qivance-e2e-v5-Sia6ve/projects`
- Happy project: `/tmp/qivance-e2e-v5-Sia6ve/projects/project_7b8fe87d0d804902`
- Final MP4: `/tmp/qivance-e2e-v5-Sia6ve/projects/project_7b8fe87d0d804902/exports/chat_dialogue_mv/final.mp4`
- Render manifest: `/tmp/qivance-e2e-v5-Sia6ve/projects/project_7b8fe87d0d804902/exports/chat_dialogue_mv/render_manifest.json`
- QA report: `/tmp/qivance-e2e-v5-Sia6ve/projects/project_7b8fe87d0d804902/data/chains/chat_dialogue_mv/qa_report.json`
- Control plane DB: `/tmp/qivance-e2e-v5-Sia6ve/projects/qivance_control.sqlite`

## Repro Commands

Focused V5 coverage:

```bash
TMPDIR=/tmp node --experimental-strip-types --test --test-reporter=spec \
  tests/prisma-control-plane.test.ts \
  tests/chain-registry-v5.test.ts \
  tests/project-create-v5.test.ts \
  tests/project-inputs-v5.test.ts \
  tests/server-runner-loop-v5.test.ts \
  tests/timing-pipeline-v5.test.ts \
  tests/chat-dialogue-runner-v5.test.ts \
  tests/workbench-html.test.ts \
  tests/workbench-v5-api.test.ts
```

Product-entry E2E:

```bash
TMPDIR=/tmp \
node --experimental-strip-types scripts/e2e-v5-product-entry.ts --allow-timing-blocked --timeout-ms 90000
```

The E2E uses a local `ffmpeg` flite speech fixture, CPU WhisperX unless overridden, and a temporary storage root. The `--allow-timing-blocked` flag only changes how missing live timing dependencies are reported; it does not allow deterministic or diagnostic timing fallback to count as success. In this session the run completed with `status: "passed"`.

## Remaining Gaps

- V5 runner execution is serialized inside the single Node server loop and persists task resource requirements, but it does not add a separate DB resource-lock table. This is acceptable for the current local single-process runner; cross-process resource locking remains future work if V5 becomes multi-process.
- `image_storyboard_mv` and executable `video_chain` are intentionally not implemented in V5 P0.
- No SaaS, auth, users, permissions, Cloudflare Access, Tailscale, template marketplace, DeepSeek lyrics generation, or MiniMax music generation was added.
