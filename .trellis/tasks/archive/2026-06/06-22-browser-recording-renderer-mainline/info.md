# Browser Recording Renderer Implementation Notes

## Source Material

- User-supplied plan: `/mnt/c/Users/Jym/Downloads/tele/qivance_chat_browser_recording_renderer_implementation_plan.md`.
- Core direction: `runtime_timeline -> runtime HTML -> JS timeline controller -> browser recording renderer -> visual.mp4 -> existing mux_final`.

## Current Repo Touch Points

- `src/lib/chat-dialogue/chat-animation-plan.ts` already produces `animation_plan.json`.
- `src/lib/chat-dialogue/chat-frame-contracts.ts`, `chat-frame-html.ts`, and `chat-frame-renderer.ts` are the static microframe path.
- `src/lib/scheduler/v5-task-handlers.ts` currently builds frame contracts/HTML in `buildChatFramesTask` and reads `frame_contracts.json` in `renderVisualTask`.
- `src/lib/export/render-manifest-v4.ts` currently requires `chain.frame_contracts`.
- `src/server.ts` and `src/lib/workbench/` contain status/API assumptions around `frame_contracts.json`.
- `.trellis/spec/backend/v4-chat-scheduler-contracts.md` currently describes static screenshot UI state as the source of truth.
- `.trellis/spec/backend/v5-control-plane-runner-contracts.md` confirms `chat_dialogue_mv` remains a V5 control-plane chain and `video_chain` must remain separate.

## Proposed New Files

- `src/lib/chat-dialogue/chat-runtime-timeline.ts`
- `tests/chat-runtime-timeline.test.ts`
- `src/lib/chat-dialogue/chat-runtime-html.ts`
- `tests/chat-runtime-html.test.ts`
- `src/lib/chat-dialogue/chat-browser-recorder.ts`
- `tests/chat-browser-recorder.test.ts`
- Optional gated smoke: `tests/chat-browser-recorder.integration.test.ts`

## Artifact Contract

Production browser-recording mode should produce:

```text
data/chains/chat_dialogue_mv/runtime_timeline.json
video/html-video/.html-video/projects/<projectId>/runtime/chat_dialogue_mv.html
data/chains/chat_dialogue_mv/browser_render_evidence.json
exports/chat_dialogue_mv/visual.mp4
exports/chat_dialogue_mv/final.mp4
data/chains/chat_dialogue_mv/qa_report.json
exports/chat_dialogue_mv/render_manifest.json
```

Fallback/debug static mode may still produce:

```text
data/chains/chat_dialogue_mv/frame_contracts.json
video/html-video/.html-video/projects/<projectId>/frames/*.html
data/chains/chat_dialogue_mv/render_frames/*.png
```

## Recorder Notes

- MVP capture strategy from the source plan: headless Chrome plus DevTools Protocol virtual-time screenshots, then ffmpeg CFR encoding.
- Keep recorder tests dependency-light by mocking browser/CDP/ffmpeg behavior.
- Use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` if present before falling back to `google-chrome`.
- If a browser automation dependency is approved later, record the dependency reason in this task before adding it.

## Verification Plan

Focused checks:

```bash
node --experimental-strip-types --test tests/chat-runtime-timeline.test.ts
node --experimental-strip-types --test tests/chat-runtime-html.test.ts
node --experimental-strip-types --test tests/chat-browser-recorder.test.ts
node --experimental-strip-types --test tests/chat-*.test.ts
npm run typecheck
git diff --check
```

Optional smoke:

```bash
QIVANCE_RUN_BROWSER_RENDER_INTEGRATION=1 node --experimental-strip-types --test tests/chat-browser-recorder.integration.test.ts
```

## Risk Controls

- Absolute `at_sec` scheduling avoids animation-duration drift.
- CSS animation should only touch `transform`, `opacity`, and `visibility`.
- Receipt read-out must preserve layout slot height.
- Header title swap uses layered nodes to avoid layout jumps.
- Static microframes remain as fallback/debug until browser recording is proven.
