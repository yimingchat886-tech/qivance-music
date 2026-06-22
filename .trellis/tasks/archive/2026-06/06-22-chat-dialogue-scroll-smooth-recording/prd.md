# Fix Chat Dialogue Scroll And Smooth Recording

## Goal

Fix `run_3e7dfa7892a54052` / `projects/3test` chat-dialogue visual output so the chat content area slides upward as one continuous conversation track, bottom messages remain fully visible as they emerge, the safety notice line is removed, and exported motion is truly 60fps.

## What I Already Know

- User reported four issues: no visible sliding/new bubble progression, bottom bubble is half covered, the safety notice text is unnecessary and should be deleted, and the dynamic chat area should move at 60fps.
- User clarified the fourth requirement: the whole chat area below the status/header region should slide upward as one group, so the bottom bubble appears through a continuous whole-track motion. This is not a per-bubble-only animation.
- The attached screenshot is available at `/mnt/c/Users/Jym/AppData/Local/Temp/codex-clipboard-35c0d21a-9459-44c6-b299-8489e383d354.png`.
- `run_3e7dfa7892a54052` maps to `projects/3test/exports/chat_dialogue_mv/render_manifest.json`.
- `projects/3test/data/chains/chat_dialogue_mv/browser_render_evidence.json` records `capture_strategy: "cdp_seek_screenshots"`, `fps: 60`, `frame_count: 6986`, and `duration_sec: 116.427755`.
- `ffprobe` confirms both `visual.mp4` and `final.mp4` are encoded as `60/1` fps with 6986 frames.
- `src/lib/chat-dialogue/chat-runtime-html.ts` currently exposes `seekTimeline(timeSec)` but only toggles message visibility/read receipt state. It does not calculate scroll position.
- The runtime chat area currently has `.chat { top: 412px; bottom: 58px; overflow: hidden; }`, leaving too little visual safety room for player controls or bottom cropping.
- The safety notice text exists in runtime HTML and static fallback HTML.
- Local tools available: `/usr/bin/google-chrome`, `/usr/bin/ffmpeg`, `/usr/bin/Xvfb`, and `/usr/bin/xvfb-run`.

## Assumptions

- Keep the task scoped to `chat_dialogue_mv` runtime rendering and export recording, not the whole V7 Douyin UI mimic task.
- Do not add a new npm dependency. If non-screenshot recording is needed, prefer installed Chrome, Xvfb, and ffmpeg.
- Existing scheduler/API contracts should remain unchanged unless required by evidence fields for the recording strategy.

## Requirements

- Remove the safety notice line from generated chat runtime output and static fallback output.
- Add deterministic whole-chat-track scroll state to runtime seek/playback: the fixed status/header region stays in place, while the chat content track below it slides upward together over time.
- Keep the newest visible message fully above the bottom reserved area.
- Preserve 1080x1920 output, local-only assets, and 60fps export.
- Evaluate replacing screenshot-sequence capture with an ffmpeg recording path that records Chrome output through Xvfb at 60fps.

## Proposed MVP

- Fix runtime and static fallback layout first: remove `safety-notice`, reserve enough bottom space, and add whole-track upward slide interpolation to `seekTimeline(timeSec)` / playback.
- Add tests proving the runtime contains whole-track scroll logic, bottom reserve, and no safety notice.
- Keep the existing deterministic 60fps seek capture path for this pass; defer `Xvfb + ffmpeg x11grab` to a later optional capture strategy if correct per-frame interpolation still proves insufficient.
- Do not add dependencies or redesign the full chat UI.

## Acceptance Criteria

- [ ] Runtime HTML no longer contains the safety notice text or `safety-notice` element.
- [ ] At representative timestamps in `projects/3test`, the chat content track has increasing upward offset while the status/header region remains fixed.
- [ ] The latest message is fully visible above the reserved bottom area when it emerges.
- [ ] Export evidence still records the deterministic screenshot seek capture strategy for this pass.
- [ ] Final `visual.mp4` / `final.mp4` remain 1080x1920 and 60fps.
- [ ] Focused chat tests and `npm run typecheck` pass.

## Definition Of Done

- Tests added/updated for whole-track scroll, bottom reserve, safety-notice removal, and capture evidence.
- Narrow visual verification against a 3test-like timeline.
- No new dependency unless explicitly confirmed.
- Specs updated only if the recording/rendering contract changes.

## Out Of Scope

- Reworking the whole Douyin visual design.
- Changing lyrics timing, speaker attribution, or message text.
- Pushing commits or archiving this task without a later explicit completion signal.

## Technical Notes

- Relevant spec: `.trellis/spec/backend/v4-chat-scheduler-contracts.md`.
- Recording research: `research/recording-options.md`.
- Relevant files found so far:
  - `src/lib/chat-dialogue/chat-runtime-html.ts`
  - `src/lib/chat-dialogue/chat-browser-recorder.ts`
  - `src/lib/chat-dialogue/chat-frame-html.ts`
  - `tests/chat-runtime-html.test.ts`
  - `tests/chat-browser-recorder.test.ts`
  - `tests/chat-frame-contracts.test.ts`
- GitNexus query for `chat dialogue browser recording scroll runtime timeline` mapped the flow through `renderChatDialogueExportForProject` and `renderChatRuntimeToVisual`.
- GitNexus impact for `renderChatRuntimeHtml` is HIGH: direct callers include `buildChatFramesForProject` and `buildChatFramesTask`, with affected server/workbench flows.
- GitNexus impact for `Function:src/lib/chat-dialogue/chat-browser-recorder.ts:renderChatRuntimeToVisual` reports LOW in the current index, but context shows it participates in `RenderChatDialogueExportForProject`.
- Current implementation is not real screen recording: `renderChatRuntimeToVisual()` calls `captureRuntimeScreenshots()`, seeks each timestamp, captures `Page.captureScreenshot`, writes PNG frames, and then ffmpeg encodes the image sequence.
