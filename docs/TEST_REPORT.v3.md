# TEST_REPORT v3

Date: 2026-06-12
Branch: `codex/v3-production-workbench`
Latest implementation commit: `fa823f4`

Sources:
- PRD: `docs/qivance_music_html_video_integration_prd.v3.md`
- SPEC: `docs/SPEC.v3.md`
- PLAN: `docs/PLAN.v3.md`

## Summary

V3 now has the file-backed Workbench/API loop, image schedule/prompt/review contracts, local source MP4 import evidence, production agent run gates, preview revision flow, render manifest v3 evidence, a basic Node-served Workbench page, and scripts for primary-ratio product E2E plus three-ratio production-strict regression.

This session verified focused unit/API coverage, broad html-video coverage, the primary-ratio product E2E flow, the source-video product E2E flow, and the three-ratio production-strict media regression with live image generation and AI-authored html-video frames.

## Implementation Evidence

| Area | Status | Evidence |
|---|---|---|
| Project status aggregation | Implemented | `src/lib/workbench/project-status.ts`; `tests/workbench-project-status.test.ts` |
| V3 API and Workbench pages | Implemented | `src/server.ts`; `src/lib/workbench/workbench-html.ts`; `tests/workbench-api.test.ts`; `tests/workbench-html.test.ts` |
| Animation Plan approval | Implemented | `workflow_checkpoints.json` approval metadata; API coverage in `tests/workbench-api.test.ts` |
| Image schedule | Implemented | `src/lib/image-generation/image-schedule.ts`; `tests/image-generation-schedule.test.ts` |
| Image prompt group | Implemented | `src/lib/image-generation/image-prompt-group.ts`; `tests/image-prompt-group.test.ts` |
| Image review decisions | Implemented | `src/lib/image-generation/image-review-decisions.ts`; `tests/image-review-decisions.test.ts` |
| Source MP4 import and product flow | Implemented, passed | `src/lib/video-html/source-video-import.ts`; `scripts/e2e-source-video-v3.ts`; `projects/v3_source_video_9x16_20260612144302` |
| Production agent gate | Implemented | `src/lib/video-html/agent-run-log.ts`; `tests/html-video-agent-production-gate.test.ts` |
| Preview revision | Implemented | `src/lib/video-html/revision-request.ts`; API coverage in `tests/workbench-api.test.ts` |
| Render manifest v3 | Implemented | `src/lib/export/render-manifest-v3.ts`; `tests/render-manifest-v3.test.ts` |
| Primary product E2E script | Implemented, passed | `scripts/e2e-product-v3.ts`; `projects/v3_product_primary_9x16_20260612132805` |
| Three-ratio regression script | Implemented, passed | `scripts/e2e-media-v3-regression.ts`; `projects/v3_media_regression_20260612135609` |

## Verification Run In This Session

```bash
TMPDIR=/tmp node --experimental-strip-types --test tests/workbench-project-status.test.ts tests/workbench-api.test.ts tests/workbench-html.test.ts tests/image-generation-schedule.test.ts tests/image-prompt-group.test.ts tests/image-review-decisions.test.ts tests/source-video-import.test.ts tests/html-video-agent-production-gate.test.ts tests/render-manifest-v3.test.ts
```

Result: passed, 37 tests.

```bash
npm run typecheck
```

Result: passed.

```bash
TMPDIR=/tmp node --experimental-strip-types --test tests/html-video-*.test.ts
```

Result: passed, 27 tests.

```bash
TMPDIR=/tmp QIVANCE_HTML_VIDEO_RUNTIME_TIMEOUT_MS=600000 QIVANCE_CODEX_IMAGE_GEN_CMD=/home/jym/workspace/qivance-music/scripts/codex-image-gen-parent-wrapper.ts PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome node --experimental-strip-types scripts/e2e-product-v3.ts --primary
```

Result: passed.

Primary artifacts:
- Project root: `/home/jym/workspace/qivance-music/projects/v3_product_primary_9x16_20260612132805`
- Agent run: `/home/jym/workspace/qivance-music/projects/v3_product_primary_9x16_20260612132805/video/html-video/.html-video/projects/v3_product_primary_9x16_20260612132805/agent_runs/agent_run_2026_06_12T13_28_06_004Z.json`
- Revision agent run: `/home/jym/workspace/qivance-music/projects/v3_product_primary_9x16_20260612132805/video/html-video/.html-video/projects/v3_product_primary_9x16_20260612132805/agent_runs/agent_run_2026_06_12T13_34_03_118Z.json`
- Render manifest: `/home/jym/workspace/qivance-music/projects/v3_product_primary_9x16_20260612132805/exports/render_manifest.json`
- Final MP4: `/home/jym/workspace/qivance-music/projects/v3_product_primary_9x16_20260612132805/exports/final.mp4`

```bash
TMPDIR=/tmp QIVANCE_HTML_VIDEO_RUNTIME_TIMEOUT_MS=600000 QIVANCE_CODEX_IMAGE_GEN_TIMEOUT_MS=900000 QIVANCE_CODEX_IMAGE_GEN_CMD=/home/jym/workspace/qivance-music/scripts/codex-image-gen-parent-wrapper.ts PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome node --experimental-strip-types scripts/e2e-media-v3-regression.ts --all
```

Result: passed.

Three-ratio artifacts:
- Storage root: `/home/jym/workspace/qivance-music/projects/v3_media_regression_20260612135609`
- Portrait manifest: `/home/jym/workspace/qivance-music/projects/v3_media_regression_20260612135609/media_e2e_v2_portrait_9x16/exports/render_manifest.json`
- Landscape manifest: `/home/jym/workspace/qivance-music/projects/v3_media_regression_20260612135609/media_e2e_v2_landscape_16x9/exports/render_manifest.json`
- Square manifest: `/home/jym/workspace/qivance-music/projects/v3_media_regression_20260612135609/media_e2e_v2_square_1x1/exports/render_manifest.json`

```bash
TMPDIR=/tmp QIVANCE_HTML_VIDEO_RUNTIME_TIMEOUT_MS=600000 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome node --experimental-strip-types scripts/e2e-source-video-v3.ts --source-video
```

Result: passed.

Source-video artifacts:
- Project root: `/home/jym/workspace/qivance-music/projects/v3_source_video_9x16_20260612144302`
- Source import: `/home/jym/workspace/qivance-music/projects/v3_source_video_9x16_20260612144302/data/source/source_video_import.json`
- Agent run: `/home/jym/workspace/qivance-music/projects/v3_source_video_9x16_20260612144302/video/html-video/.html-video/projects/v3_source_video_9x16_20260612144302/agent_runs/agent_run_2026_06_12T14_43_03_091Z.json`
- Revision agent run: `/home/jym/workspace/qivance-music/projects/v3_source_video_9x16_20260612144302/video/html-video/.html-video/projects/v3_source_video_9x16_20260612144302/agent_runs/agent_run_2026_06_12T14_46_38_870Z.json`
- Render manifest: `/home/jym/workspace/qivance-music/projects/v3_source_video_9x16_20260612144302/exports/render_manifest.json`
- Final MP4: `/home/jym/workspace/qivance-music/projects/v3_source_video_9x16_20260612144302/exports/final.mp4`

## Repro Commands

Primary-ratio product flow:

```bash
TMPDIR=/tmp \
QIVANCE_HTML_VIDEO_RUNTIME_TIMEOUT_MS=600000 \
QIVANCE_CODEX_IMAGE_GEN_CMD=/home/jym/workspace/qivance-music/scripts/codex-image-gen-parent-wrapper.ts \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome \
node --experimental-strip-types scripts/e2e-product-v3.ts --primary
```

Expected artifacts:
- `projects/v3_product_primary_9x16_<timestamp>/workflow_checkpoints.json`
- `projects/v3_product_primary_9x16_<timestamp>/data/storyboard/image_generation_schedule.json`
- `projects/v3_product_primary_9x16_<timestamp>/data/storyboard/image_prompt_group.json`
- `projects/v3_product_primary_9x16_<timestamp>/data/storyboard/image_review_decisions.json`
- `projects/v3_product_primary_9x16_<timestamp>/video/html-video/.html-video/projects/<id>/agent_runs/*.json`
- `projects/v3_product_primary_9x16_<timestamp>/revision_request.json`
- `projects/v3_product_primary_9x16_<timestamp>/exports/render_manifest.json`
- `projects/v3_product_primary_9x16_<timestamp>/exports/final.mp4`

Three-ratio production-strict regression:

```bash
TMPDIR=/tmp \
QIVANCE_HTML_VIDEO_RUNTIME_TIMEOUT_MS=600000 \
QIVANCE_CODEX_IMAGE_GEN_TIMEOUT_MS=900000 \
QIVANCE_CODEX_IMAGE_GEN_CMD=/home/jym/workspace/qivance-music/scripts/codex-image-gen-parent-wrapper.ts \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome \
node --experimental-strip-types scripts/e2e-media-v3-regression.ts --all
```

Expected artifacts:
- `projects/v3_media_regression_<timestamp>/media_e2e_v2_portrait_9x16/exports/render_manifest.json`
- `projects/v3_media_regression_<timestamp>/media_e2e_v2_landscape_16x9/exports/render_manifest.json`
- `projects/v3_media_regression_<timestamp>/media_e2e_v2_square_1x1/exports/render_manifest.json`
- `docs/TEST_REPORT.v3.md` appended media E2E evidence when the command is run locally.

Source-video product flow:

```bash
TMPDIR=/tmp \
QIVANCE_HTML_VIDEO_RUNTIME_TIMEOUT_MS=600000 \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome \
node --experimental-strip-types scripts/e2e-source-video-v3.ts --source-video
```

Expected artifacts:
- `projects/v3_source_video_9x16_<timestamp>/data/source/source_video_import.json`
- `projects/v3_source_video_9x16_<timestamp>/video/html-video/.html-video/projects/<id>/frames/01-scene_001_source_video.html`
- `projects/v3_source_video_9x16_<timestamp>/video/html-video/.html-video/projects/<id>/agent_runs/*.json`
- `projects/v3_source_video_9x16_<timestamp>/revision_request.json`
- `projects/v3_source_video_9x16_<timestamp>/exports/render_manifest.json`
- `projects/v3_source_video_9x16_<timestamp>/exports/final.mp4`

## Three-Ratio Evidence

| Ratio | Status | Manifest | Live imagegen | AI-authored frames | Review decision source |
|---|---|---|---|---|---|
| portrait-9x16 | passed | `/home/jym/workspace/qivance-music/projects/v3_media_regression_20260612135609/media_e2e_v2_portrait_9x16/exports/render_manifest.json` | passed | passed | file |
| landscape-16x9 | passed | `/home/jym/workspace/qivance-music/projects/v3_media_regression_20260612135609/media_e2e_v2_landscape_16x9/exports/render_manifest.json` | passed | passed | file |
| square-1x1 | passed | `/home/jym/workspace/qivance-music/projects/v3_media_regression_20260612135609/media_e2e_v2_square_1x1/exports/render_manifest.json` | passed | passed | file |

## Remaining Gaps

- No open V3 P0 verification gap remains from `docs/PLAN.v3.md` / `docs/SPEC.v3.md`.
- Local live agent/image-generation runs required extended timeouts: `QIVANCE_HTML_VIDEO_RUNTIME_TIMEOUT_MS=600000` and `QIVANCE_CODEX_IMAGE_GEN_TIMEOUT_MS=900000`.
