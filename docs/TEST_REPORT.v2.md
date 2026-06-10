# TEST_REPORT.v2

Date: 2026-06-09
Branch: `codex/v2-media-e2e`
Scope: V2 media E2E hardening foundation.

## Commands

- `node --experimental-strip-types --test tests/*.test.ts`: passed, 81 tests.
- `node --experimental-strip-types --test tests/media-e2e-fixture-contract.test.ts tests/media-e2e-checkpoints.test.ts tests/media-e2e-workflow.test.ts tests/audio-analysis-artifacts.test.ts tests/word-alignment-normalizer.test.ts tests/word-alignment-quality-gate.test.ts tests/alignment-override.test.ts tests/section-map-builder.test.ts tests/image-generation-assets.test.ts tests/html-video-frame-output-validator.test.ts tests/ffprobe-fields.test.ts tests/mux-locked-audio-mp3.test.ts tests/render-manifest-v2.test.ts tests/media-e2e-test-report.test.ts tests/media-e2e-real-fixtures.test.ts`: passed.
- `node node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/tsc.js -p tsconfig.json --noEmit`: passed.
- `pnpm test`: passed, 21 html-video tests.
- `node --experimental-strip-types --test tests/html-video-*.test.ts`: passed.
- `pnpm -r build`: passed; Vite reported chunk size warnings only.
- `npx gitnexus analyze`: passed; repository indexed successfully.
- `npx gitnexus detect-changes --repo qivance-music`: medium risk; affected flows are `ffprobe` parsing flows, matching the expected export/probe change.
- `ffprobe` on all three V2 fixture MP3 files: passed; codec `mp3`; durations approximately 24.03s, 28.03s, and 32.03s.
- `python3 scripts/python/analyze-audio-librosa.py fixtures/media-e2e-v2/portrait-9x16/active_music_take.mp3 /tmp/qivance-media-e2e-audio-check`: failed, `ModuleNotFoundError: No module named 'librosa'`.
- `node --experimental-strip-types scripts/e2e-media-v2.ts --fixture portrait-9x16`: failed, `runMediaE2EWorkflow` remains an intentional stub.
- `node --input-type=module -e ... @html-video/runtime detectOne`: passed; runtime detects `codex`, `claude`, and `hermes`; AMR is installed but not logged in.

## Manifest Evidence

- portrait-9x16: fixture created at `fixtures/media-e2e-v2/portrait-9x16`.
- landscape-16x9: fixture created at `fixtures/media-e2e-v2/landscape-16x9`.
- square-1x1: fixture created at `fixtures/media-e2e-v2/square-1x1`.
- Runtime render manifests under `projects/media_e2e_v2_*/exports/render_manifest.json` were not produced because full local E2E is not wired yet.

## Conclusion

V2 media E2E is not complete.

Completed: fixture contract, checkpoints, mockable workflow order, real librosa artifact generation through project-rap `.venv`, WhisperX seed word timing fixtures from project-rap, word timing quality gates, section map builder, image generation adapter/lock gate, html-video runtime bridge, frame output reference validation, MP3 to AAC mux command builder, ffprobe codec/stream fields, V2 render manifest skeleton, report writer, and three 20-40 second real MP3 fixture bundles.

Unproven paths: running WhisperX fresh inside qivance-music instead of using project-rap seed evidence, real Codex image_gen invocation, full html-video own agent/runtime frame authoring, visual render, MP3 to AAC final mux on real rendered video, static Preview browser smoke, and three-ratio local full E2E.


## Missing For Full Local E2E

- V2 fixture-to-html-video workflow is not wired yet: `runMediaE2EWorkflow` remains a stub.
- Fresh WhisperX execution inside qivance-music is not run yet; current word timing fixture evidence is seeded from project-rap `AI智能体/section_map.json`.
- Real Codex `image_gen` invocation is not wired into `codexImageGenAdapter` yet.
- html-video runtime bridge is implemented and detects local `codex`, `claude`, and `hermes`, but the V2 workflow does not yet call it to author frames.
- Real visual render, final MP3-to-AAC mux, final ffprobe QA, static Preview smoke, and three-ratio local full E2E are still unproven.


## 2026-06-10 Real Orchestrator Progress

Scope: solidify Python env, add fresh WhisperX/librosa runner contract, implement real 15-step runMediaE2EWorkflow fail-fast orchestrator, and run available local E2E gates.

Commands and evidence:

- /usr/bin/node --experimental-strip-types --test tests/python-env-contract.test.ts tests/whisperx-runner.test.ts tests/codex-image-gen-external-command.test.ts: passed, 6 tests.
- /usr/bin/node --experimental-strip-types --test tests/frame-output-contract-validator.test.ts tests/media-qa.test.ts: passed, 4 tests.
- /usr/bin/node --experimental-strip-types --test tests/whisperx-runner.test.ts: passed, 3 tests including timeout fail-fast.
- /usr/bin/node node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/tsc.js -p tsconfig.json --noEmit: passed.
- .venv/bin/python import check: librosa 0.11.0 and torch CUDA true. Local .venv is a gitignored symlink to the known-good project-rap env because copying the 7.6G env was not practical.
- /usr/bin/node --experimental-strip-types scripts/e2e-media-v2.ts --fixture portrait-9x16: fixture, librosa, fresh WhisperX, and section_map passed; failed at generate_background_images because QIVANCE_CODEX_IMAGE_GEN_CMD is not configured.
- /usr/bin/node --experimental-strip-types scripts/e2e-media-v2.ts --fixture landscape-16x9: same result; failed at generate_background_images because QIVANCE_CODEX_IMAGE_GEN_CMD is not configured.
- /usr/bin/node --experimental-strip-types scripts/e2e-media-v2.ts --fixture square-1x1: same result; failed at generate_background_images because QIVANCE_CODEX_IMAGE_GEN_CMD is not configured.

Fresh WhisperX evidence:

- projects/media_e2e_v2_portrait_9x16/timing/alignment_report.json: status passed, backend whisperx, whisperx 3.8.6, librosa 0.11.0, torch 2.8.0+cu128, CUDA 12.8, GPU NVIDIA GeForce RTX 4070 SUPER, word coverage 1.0.
- projects/media_e2e_v2_landscape_16x9/timing/alignment_report.json: produced by fresh workflow before image_gen gate.
- projects/media_e2e_v2_square_1x1/timing/alignment_report.json: produced by fresh workflow before image_gen gate.

Current blocker:

- Real Codex image_gen external command is not available. The adapter now intentionally fails with: QIVANCE_CODEX_IMAGE_GEN_CMD is required for real Codex image_gen E2E execution.
- Because image generation is a hard V2 gate and every fixture requires at least one generated background scene, html-video runtime/frame generation, static preview smoke, visual_silent.mp4 render, AAC mux, ffprobe final QA, passed render_manifest.json, and full three-ratio local E2E remain unexecuted.

Conclusion: V2 is materially advanced but not complete. The missing boundary is no longer librosa, WhisperX, or workflow orchestration; it is the absence of a real external Codex image_gen command.
