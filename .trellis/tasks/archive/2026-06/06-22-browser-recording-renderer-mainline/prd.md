# Browser Recording Renderer Mainline

## Goal

Convert `chat_dialogue_mv` visual rendering from static screenshot microframes to a browser-recording main path, so the chat page plays like a real messaging app: messages enter on an absolute timeline, CSS performs the bubble/receipt/header motion, and the renderer captures that browser playback to `exports/chat_dialogue_mv/visual.mp4`.

## User Need

The current chain simulates animation by rendering many static HTML frames to PNG, then concatenating them with ffmpeg. The desired product behavior is a single runtime chat page that continuously runs, with right bubbles floating in, read receipts appearing only after eligible right messages, left replies triggering typing state, and all motion captured at 60fps.

## Assumptions

- Source plan: `/mnt/c/Users/Jym/Downloads/tele/qivance_chat_browser_recording_renderer_implementation_plan.md`.
- "主线" means production default for `chat_dialogue_mv` visual rendering after this task is implemented.
- Static microframes remain available as fallback/debug; this task does not delete the old renderer.
- This task does not change lyrics parsing, speaker attribution, word timing, section map, audio mux, QA duration drift rules, or `video_chain`.
- Task creation is docs/task setup only; no source code is modified yet.

## Requirements

1. Add a runtime timeline contract for `chat_dialogue_mv`.
   - Write `data/chains/chat_dialogue_mv/runtime_timeline.json`.
   - Use `render_mode: "browser_recording"`, `target_ratio: "9:16"`, `width: 1080`, `height: 1920`, and `fps: 60`.
   - Events use absolute `at_sec` timing, not cumulative waits.
   - Left messages use `enter_delay_ms = 40`.
   - Right `questioner` messages show receipt only when followed by a left reply.
   - Left message events hide the previous eligible right receipt.

2. Add runtime HTML for the production chat playback page.
   - Write `video/html-video/.html-video/projects/<projectId>/runtime/chat_dialogue_mv.html`.
   - Keep all resources local-only.
   - Render all messages in the DOM initially hidden.
   - Expose `window.__qivanceChatRuntime = { ready, play, stop, getState, durationMs }`.
   - JS only schedules events and toggles classes; CSS owns transform/opacity/visibility animation.
   - Header typing uses separate `peer-name` and `typing-name` nodes, not direct text replacement.
   - Receipt read-out must not use `display:none`, so message stacks do not jump.

3. Add a browser recorder for production visual output.
   - Open runtime HTML in headless Chrome.
   - Wait for fonts/images/runtime readiness.
   - Start timeline playback.
   - Capture frames at 60fps and encode `exports/chat_dialogue_mv/visual.mp4`.
   - Write `data/chains/chat_dialogue_mv/browser_render_evidence.json`.
   - Use constant-frame-rate ffmpeg input, not the old concat-duration list.

4. Switch scheduler rendering to the browser-recording path.
   - `build_chat_frames` should produce `animation_plan.json`, `runtime_timeline.json`, and runtime HTML by default.
   - `frame_contracts.json` and per-frame HTML should only be produced for fallback/debug mode.
   - `render_visual` should route by `runtime_timeline.render_mode`.
   - `mux_final` continues to mux `visual.mp4` with `active_music_take.mp3`.
   - `qa_report` keeps the existing one-audio-stream and duration-drift checks, with optional browser evidence consistency checks.

5. Update manifest/status contracts.
   - `render_manifest.json` should record runtime timeline, runtime HTML, browser render evidence, `renderMode`, and `fps`.
   - `frameContracts` should become optional or fallback-only for `chat_dialogue_mv` production.
   - API/workbench/status paths that currently assume `frame_contracts.json` must be audited so browser-recording output is not falsely reported as missing frame contracts.
   - `.trellis/spec/backend/v4-chat-scheduler-contracts.md` must be updated before or with source implementation.

6. Keep the existing chain boundaries.
   - Do not rewrite audio/timing/conversation-plan generation.
   - Do not alter `video_chain`.
   - Do not broaden into template markets, stickers, reply buttons, or unrelated visual redesign.

## Acceptance Criteria

- [ ] `runtime_timeline.json` validates schema, fps, duration, event ordering, message references, side/speaker parity, receipt rules, and left delay.
- [ ] Runtime HTML is local-only, contains runtime data, contains all messages hidden initially, exposes the runtime API, and includes bubble, avatar, receipt, and header animations.
- [ ] Browser recorder unit tests mock browser/ffmpeg and verify Chrome args, frame count, fps, ffmpeg encoding args, evidence write, failure errors, and temp cleanup.
- [ ] Scheduler tests prove browser recording is default and static microframes are fallback/debug only.
- [ ] Manifest tests prove runtime artifacts are recorded and `frameContracts` is not required for browser-recording production.
- [ ] Focused checks pass: runtime timeline tests, runtime HTML tests, browser recorder tests, relevant scheduler/manifest tests, `npm run typecheck`, and `git diff --check`.
- [ ] Optional integration smoke can generate `visual.mp4` from a short chat fixture when `QIVANCE_RUN_BROWSER_RENDER_INTEGRATION=1`.
- [ ] Visual smoke confirms no hard-cut message entry, no receipt/header/layout jumping, no long-text overflow, and final MP4 drift remains <= 150ms.

## Technical Approach

Main pipeline:

```text
conversation_plan + animation_plan
  -> runtime_timeline.json
  -> runtime/chat_dialogue_mv.html
  -> JS timeline class toggles + CSS motion
  -> browser recorder at 60fps
  -> exports/chat_dialogue_mv/visual.mp4
  -> existing mux_final
```

The implementation should be split into small PR-sized steps:

1. Spec/contract update for browser-recording mainline.
2. Runtime timeline module and tests.
3. Runtime HTML/JS/CSS module and tests.
4. Browser recorder MVP and tests.
5. Scheduler, manifest, API/workbench status updates.
6. Optional integration visual smoke.

## Decision (ADR-lite)

**Context**: Static microframes are deterministic but cannot represent a live chat page where CSS animation and JS timeline run continuously.

**Decision**: Make browser recording the production visual renderer for `chat_dialogue_mv`, with static microframes retained only as fallback/debug.

**Consequences**:

- Production evidence moves from static `frame_contracts.json` to runtime timeline, runtime HTML, and browser render evidence.
- The scheduler and manifest must stop treating `frame_contracts.json` as mandatory for production success in browser-recording mode.
- The recorder introduces browser automation complexity; keep it narrowly scoped and test it mostly with mocks.

## Implementation Decision

- Recorder dependency strategy: no new dependency for this task.
- Browser recording uses the existing Chrome/ffmpeg environment and a narrow CDP screenshot recorder.
- A browser automation dependency such as Playwright remains out of scope unless the CDP path becomes demonstrably more code than it saves.

## Out of Scope

- Removing the static frame renderer.
- Changing lyrics, timing, speaker attribution, conversation-plan semantics, muxing, QA drift rules, or `video_chain`.
- Adding new UI product features beyond bubble/receipt/header motion needed for this renderer.
- Full browser performance optimization beyond a working deterministic 60fps capture path.

## Definition of Done

- Source edits are preceded by GitNexus impact analysis for each edited symbol.
- Reusable contract changes are captured in `.trellis/spec/backend/v4-chat-scheduler-contracts.md`.
- Tests cover the new runtime contract, runtime HTML, recorder, scheduler routing, and manifest behavior.
- `npm run typecheck` and focused tests pass, or skipped checks are recorded with exact reasons.
- `npx gitnexus detect-changes --repo qivance-music` runs before commit.

## Technical Notes

- Existing implementation still centers on `frame_contracts.json`, per-frame HTML, `renderChatFramesToVisual`, and `render-manifest-v4`.
- Existing `package.json` has no browser automation dependency.
- Current dirty worktree had pre-existing unrelated changes when this task was created; implementation should avoid staging or modifying them unless they are intentionally part of this task.
