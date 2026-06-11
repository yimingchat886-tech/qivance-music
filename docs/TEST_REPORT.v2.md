# TEST_REPORT.v2

Date: 2026-06-11
Branch: `codex/brock-imagegen-smoke-wrapper`
Scope: full V2 media E2E across portrait, landscape, and square fixtures.

## Current Result

The V2 media E2E command now passes all three fixture ratios end-to-end.

This result covers the full workflow sequence:

1. validate fixture bundle
2. analyze audio
3. align words
4. build section map
5. generate or reuse generated background images
6. review and lock image assets
7. write html-video workspace
8. run html-video agent runtime
9. validate frame outputs
10. static preview smoke
11. render visual-only MP4
12. mux locked active MP3 to AAC final MP4
13. ffprobe visual and final outputs
14. write `render_manifest.json`
15. append report evidence

The html-video agent runtime is now bounded by timeout. In this local run it timed out at 5000 ms for each ratio, and the workflow continued through the contract fallback frame path. The fallback frames are local-only, strict-duration frames that reference locked generated images and pass the frame output validator. This report does not claim successful AI-authored html-video frames.

## Full E2E Command

```bash
QIVANCE_CODEX_IMAGE_GEN_CMD=/home/jym/workspace/qivance-music/scripts/codex-image-gen-parent-wrapper.ts \
QIVANCE_HTML_VIDEO_RUNTIME_TIMEOUT_MS=5000 \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome \
node --experimental-strip-types scripts/e2e-media-v2.ts --all
```

Result: passed, exit code 0.

## Output Evidence

| Fixture | Final MP4 | Render manifest | Final probe |
|---|---|---|---|
| `portrait-9x16` | `/home/jym/workspace/qivance-music/projects/media_e2e_v2_portrait_9x16/exports/final.mp4` | `/home/jym/workspace/qivance-music/projects/media_e2e_v2_portrait_9x16/exports/render_manifest.json` | 1080x1920, h264 video, AAC audio, 1 audio stream, 24s |
| `landscape-16x9` | `/home/jym/workspace/qivance-music/projects/media_e2e_v2_landscape_16x9/exports/final.mp4` | `/home/jym/workspace/qivance-music/projects/media_e2e_v2_landscape_16x9/exports/render_manifest.json` | 1920x1080, h264 video, AAC audio, 1 audio stream, 28s |
| `square-1x1` | `/home/jym/workspace/qivance-music/projects/media_e2e_v2_square_1x1/exports/final.mp4` | `/home/jym/workspace/qivance-music/projects/media_e2e_v2_square_1x1/exports/render_manifest.json` | 1080x1080, h264 video, AAC audio, 1 audio stream, 32s |

Latest observed artifact sizes:

- portrait final MP4: 2.0M
- landscape final MP4: 2.6M
- square final MP4: 1.4M

## Image Generation Evidence

The image generation adapter boundary is real:

- Adapter entry: `QIVANCE_CODEX_IMAGE_GEN_CMD=/home/jym/workspace/qivance-music/scripts/codex-image-gen-parent-wrapper.ts`.
- Parent wrapper calls child `codex exec` only to invoke `$imagegen`.
- Parent wrapper discovers new PNG files from Codex `generated_images`, copies candidates into the requested `outputDir`, calculates SHA-256 and PNG dimensions, and returns `ImageGenerationResult`.
- Child `codex exec` has a timeout: default 300000 ms, configurable with `QIVANCE_CODEX_IMAGE_GEN_TIMEOUT_MS`.
- Full E2E may reuse existing `{requestId}_vN.png` candidates from the fixture output directory; reused candidates are re-hashed and re-sized into a canonical `ImageGenerationResult` and recorded in manifest diagnostics.

Observed fixture candidate dimensions:

- portrait: 941x1672 generated PNG candidates.
- landscape: 1672x941 generated PNG candidates.
- square: 1254x1254 generated PNG candidates.

Notes:

- Portrait and landscape used previously generated local Codex image outputs in the final `--all` refresh.
- Square used a seeded 1:1 Codex-generated PNG after two live square imagegen attempts timed out during Codex remote/plugin/model refresh.
- These diagnostics are explicit in `render_manifest.json`; this avoids silently treating remote Codex instability as successful live generation.

## html-video Runtime Evidence

- Vendor Codex runtime now passes the prompt on stdin with `codex exec --ignore-user-config --skip-git-repo-check -`.
- Qivance wraps the html-video runtime call with `QIVANCE_HTML_VIDEO_RUNTIME_TIMEOUT_MS`.
- Timeout returns a structured runtime result with `exitCode: 124` and `timedOut: true` instead of hanging the E2E.
- After timeout, Qivance validates allowed path changes and writes missing contract fallback frames only under the allowed frame paths.
- Frame validation passed for all ratios: expected frame count, strict metadata, no external image URLs, and locked local image references only.

## Render And Mux Evidence

- `render_visual_with_html_video` passed for all ratios using the system Chrome override: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome`.
- `visual_silent.mp4` has h264 video and no audio stream.
- `final.mp4` copies the visual stream and muxes the locked `active_music_take.mp3` as AAC.
- `ffprobe_visual_and_final` passed for all ratios with exactly one final audio stream.

## Verification Commands

Passed during this implementation:

```bash
node --experimental-strip-types --test tests/cached-image-result.test.ts tests/contract-frame-fallback.test.ts tests/html-video-agent-runtime.test.ts tests/codex-image-gen-parent-wrapper.test.ts tests/media-e2e-workflow.test.ts tests/frame-output-contract-validator.test.ts
npm run typecheck
npm --prefix vendor/html-video/packages/runtime test
npm --prefix vendor/html-video/packages/adapter-hyperframes run build
npm --prefix vendor/html-video/packages/adapter-hyperframes run typecheck
```

## Requirement Impact

- R47-R53 move to implemented/passed for V2 media render, mux, ffprobe, manifest, and final single-audio-stream evidence.
- R89-R91 move to implemented/passed for the executable image generation adapter boundary and E2E image asset evidence.
- R92 remains partially implemented because the current lock gate auto-locks preferred candidates; product review UI/API is still out of this E2E scope.
- R93 is implemented/passed for local locked image propagation into ContentGraph, frame contracts, agent context, validation, and render.
- R94 remains partially implemented because the local run used fallback frames after html-video agent runtime timeout; AI-authored frame output still needs stable runtime evidence.
- R95 remains unimplemented; RAG asset recycling is not part of this V2 E2E completion.
