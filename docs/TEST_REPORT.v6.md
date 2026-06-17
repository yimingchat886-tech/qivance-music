# V6 Test Report

Date: 2026-06-17

Scope: Patch D validators, V6 frame semantics, MP4 error mapping, package scripts, and real E2E evidence reporting.

## Summary

V6 mock/unit and focused backend integration coverage passed. Real product-entry E2E did not reach product acceptance because the local html-video agent runtime timed out during preview frame generation.

The blocked E2E result is not counted as a successful V6 product acceptance run.

## Mock Unit Tests

Passed:

```bash
TMPDIR=/tmp node --experimental-strip-types --test tests/render-manifest-v6.test.ts tests/video-chain-frame-validation.test.ts
```

Coverage:

- schema v6 render manifest gates and 64-character lowercase sha256 evidence validation
- video_chain frame semantics for locked muted MP4 background, unsafe media URL rejection, no controls, no source-video audio, and overlay markers

## Focused Integration Tests

Passed:

```bash
npm run typecheck
npm run test:v5
npm run test:v6
npm run test:backend
```

Notes:

- `tests/video-chain-runner.test.ts` still uses mocked html-video/render/mux/ffprobe dependencies and is not real product acceptance evidence.
- `tests/source-video-import.test.ts` includes route-level API coverage for fake/missing MP4 failures returning clear `source_video_import_failed` 409 responses instead of 500.
- API-focused tests require local `127.0.0.1` listener permission.

## Real html-video E2E Evidence

Command:

```bash
TMPDIR=/tmp npm run e2e:v6
```

Result:

```json
{
  "status": "blocked_dependency",
  "evidence_kind": "real_html_video_e2e_blocked",
  "reason": "html_video_runtime_dependency",
  "storage_root": "/tmp/qivance-e2e-v6-lkSS4h/projects",
  "details": {
    "project_id": "project_a81686d582c345ff",
    "phase": "preview",
    "run_status": "failed",
    "failed_task_stage": "build_video_frames",
    "last_error": "video_chain_agent_failed: missing frame: frames/01-video_card_001.html; frames/01-video_card_001.html: missing frame for background video validation; production agent run timed out; production agent run exited with code 124; production agent run produced no AI-authored frame paths"
  }
}
```

Observed error:

```text
video_chain_agent_failed: missing frame: frames/01-video_card_001.html; frames/01-video_card_001.html: missing frame for background video validation; production agent run timed out; production agent run exited with code 124; production agent run produced no AI-authored frame paths
```

Storage root for this run:

```text
/tmp/qivance-e2e-v6-lkSS4h/projects
```

Interpretation: the product-entry API and runner reached the real preview frame generation stage, but the local html-video agent runtime did not produce frames before timeout. No mock output was treated as product acceptance.

## Known Gaps

- No passing real V6 html-video E2E final export evidence yet.
- No real final `exports/video_chain/final.mp4` acceptance from `e2e:v6` yet.
- No real schema v6 manifest from a completed E2E export yet.
- Rerun `TMPDIR=/tmp npm run e2e:v6` after the local html-video agent runtime can complete frame generation.
