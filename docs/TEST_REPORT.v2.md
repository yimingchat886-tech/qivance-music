# TEST_REPORT.v2

Date: 2026-06-11
Branch: `codex/brock-imagegen-smoke-wrapper`
Scope: V2 media E2E evidence refresh after adding the parent-side Codex image generation wrapper.

## Current Result

V2 media E2E is advanced past the former image generation command blocker, but the full 15-step three-ratio E2E is not marked complete in this report.

The image generation boundary now has a real external command path:

- Adapter entry: `QIVANCE_CODEX_IMAGE_GEN_CMD=/home/jym/workspace/qivance-music/scripts/codex-image-gen-parent-wrapper.ts`.
- Parent wrapper calls child `codex exec` only to invoke `$imagegen`.
- Parent wrapper discovers new PNG files from Codex `generated_images`, copies the selected candidates into the requested `outputDir`, calculates SHA-256 and PNG dimensions, and returns `ImageGenerationResult`.
- Child `codex exec` has a timeout: default 300000 ms, configurable with `QIVANCE_CODEX_IMAGE_GEN_TIMEOUT_MS`.

Full E2E remains unclaimed because the workflow continues after image generation into html-video agent runtime, frame validation, preview smoke, visual render, mux, ffprobe QA, manifest write, and report append. Those downstream production gates need their own full run evidence before V2 can be called complete.

## Commands

- `node --experimental-strip-types --test tests/codex-image-gen-parent-wrapper.test.ts tests/codex-image-gen-external-command.test.ts`: passed, 5 tests.
- `node --experimental-strip-types --test tests/codex-image-gen-parent-wrapper.test.ts tests/codex-image-gen-smoke-wrapper.test.ts tests/codex-image-gen-external-command.test.ts`: passed, 9 tests before the final committed-file-only recheck.
- `npm run typecheck`: passed.
- `git diff --cached --check`: passed before commit `a73032e`.
- `/home/jym/.nvm/versions/node/v24.14.0/bin/gitnexus analyze`: passed; repository indexed successfully after adding the wrapper entrypoint and module.

## Live Image Generation Smoke

Input request:

- requestId: `img_req_parent_smoke_001`
- sceneId: `scene_parent_smoke_001`
- assetRole: `background`
- aspectRatio: `1:1`
- targetSize: `1024x1024`
- outputDir: `/tmp/qivance-codex-imagegen-parent-live`

Observed result:

- status: `succeeded`
- copied output: `/tmp/qivance-codex-imagegen-parent-live/img_req_parent_smoke_001_v1.png`
- source generated image: `/mnt/c/Users/jym/.codex/generated_images/019eb667-9ddb-74d3-bcab-886ada35644c/ig_07d08f890cb72a50016a2a99ccd7bc81938c3eec3757492ab8.png`
- dimensions: `1254x1254`
- sha256: `3e2c00fd63c660fa2829939ea7bb028d8181a5ff835dcc1b5488607732b0e139`
- diagnostics included `child_final_message: IMAGE_GEN_DONE`.

## Manifest Evidence

No passed runtime render manifests are claimed by this refresh. The latest smoke verifies the image generation adapter boundary only; it does not produce `projects/media_e2e_v2_*/exports/render_manifest.json`.

Expected manifest evidence for full completion remains:

- `projects/media_e2e_v2_portrait_9x16/exports/render_manifest.json`
- `projects/media_e2e_v2_landscape_16x9/exports/render_manifest.json`
- `projects/media_e2e_v2_square_1x1/exports/render_manifest.json`

## Requirement Impact

- R89-R91 move from blocked/unimplemented to partially implemented with direct wrapper and adapter evidence.
- R92-R94 remain partially implemented because lock-gate and local-only asset consumption are wired in code paths/tests, but a full workflow run has not proven all downstream html-video/render gates after real image generation.
- R95 remains unimplemented for V2 because RAG asset recycling is not part of this wrapper fix.

## Remaining Work For Full V2 Media E2E

- Run all three fixtures with `QIVANCE_CODEX_IMAGE_GEN_CMD` set to the parent wrapper.
- Capture html-video agent runtime evidence for generated frames.
- Validate frames only reference locked local images.
- Produce `visual_silent.mp4`, mux the locked active MP3 to final AAC MP4, and run ffprobe QA.
- Write passed render manifests and append final report evidence for all three ratios.
