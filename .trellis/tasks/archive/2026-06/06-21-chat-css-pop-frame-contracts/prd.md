# Implement chat dialogue CSS pop frame contracts

## Goal

Make `chat_dialogue_mv` render CSS pop chat motion through deterministic frame contracts instead of browser runtime timelines, so PNG-frame rendering stays stable while bubbles, read receipts, and header typing states look fluid.

## What I Already Know

- Source review: `/mnt/c/Users/Jym/Downloads/tele/qivance_chat_css_pop_review.md`.
- Current render chain is static-frame based: `renderChatFrameHtml` writes one HTML file per frame, headless Chrome screenshots each HTML, then ffmpeg concatenates PNGs into `visual.mp4`.
- Runtime JS timelines are out of scope because each HTML frame starts from a fresh page load.
- `scroll_windows` should remain the logical visible-message window; visual microstate belongs in `frame_contracts`.
- Default avatar mapping is `left_avatar_src: ../assets/avatars/1.jpg` and `right_avatar_src: ../assets/avatars/2.jpg`.
- User detail: the avatar inside the right-side `已读 + 头像` receipt must use the left avatar image, defaulting to `1.jpg`.

## Requirements

- Add a minimal `ui_state` to `ChatFrameContract` for:
  - header state or phase (`default`, `typing`, and progress when needed);
  - entering message id plus `enter_progress`;
  - read receipt message id, state (`hidden`, `in`, `on`, `out`), and progress.
- Expand `buildChatFrameContracts` from logical `scroll_windows` into visual microframes at a fixed 30fps by default.
- Keep total frame duration equal to `animationPlan.duration_sec`; let the final stable frame absorb small floating-point drift.
- Keep `scroll_windows` as logical visibility only. Do not move CSS-pop microstate into `chat-animation-plan.ts` unless implementation proves it is strictly necessary.
- Use paused CSS keyframes driven by contract state/progress, not browser clock or JS timeline playback.
- Right-side read receipt appears only for a right/questioner message that is followed by a left reply.
- If multiple right messages precede the next left reply, only the nearest qualifying right/questioner message shows the receipt.
- Right-side receipt should not delay or move the left reply; if spacing is short, compress or skip receipt animation before sacrificing bubble pop or header correctness.
- Left reply may reserve layout at `T1`, then starts visible bubble pop at `T1 + 40ms`.
- Header typing state must come from `frame.ui_state.header`, not from the side of the latest visible message.
- Receipt rendering must come from `frame.ui_state.read_receipt`, not `readReceiptMessageIndex(messages)`.
- The receipt avatar in the right-side `已读 + 头像` slot must render the left avatar image (`uiProfile.leftAvatarSrc`, default `../assets/avatars/1.jpg`), not a gray placeholder and not `right_avatar_src`/`2.jpg`.
- Preserve long lyric wrapping rules: `white-space: pre-wrap`, `overflow-wrap: anywhere`, and `word-break: break-word`.

## Acceptance Criteria

- [ ] `frame_contracts.json` contains deterministic `ui_state` for bubble entry, receipt, and header typing.
- [ ] Frame durations are all positive and sum to `animationPlan.duration_sec`.
- [ ] All conversation messages remain covered by at least one frame.
- [ ] Right bubble entry frames have monotonic `enter_progress` in `0..1`.
- [ ] Only qualifying right/questioner messages followed by a left reply can have `read_receipt`.
- [ ] Receipt state can express `hidden -> in -> on -> out -> hidden`.
- [ ] Left reply bubble pop starts around `left.start_sec + 40ms`.
- [ ] Header transitions are controlled by `ui_state`, and left stable frames restore the default contact title.
- [ ] Rendered HTML includes paused CSS keyframes for pop/receipt/header motion.
- [ ] Right-side `已读 + 头像` HTML includes an `<img>` using `../assets/avatars/1.jpg` by default.
- [ ] No JS timeline controller, new animation dependency, Playwright dependency, canvas renderer, or new video renderer is added.
- [ ] Existing chat frame outputs remain local-resource only; no remote stylesheet or remote image is introduced.

## Definition of Done

- Focused tests updated for frame contracts and HTML rendering.
- `npm run typecheck` passes.
- Relevant focused tests pass, at minimum `tests/chat-frame-contracts.test.ts` and any touched chat renderer tests.
- `git diff --check` passes before handoff or commit.
- No unrelated source, docs, config, lockfile, mux, manifest, timing, or `video_chain` changes are included.

## Technical Approach

Use contract-driven visual state. `chat-frame-contracts.ts` turns each logical window into microframes with explicit progress values. `chat-frame-html.ts` maps those values to classes, CSS variables, and paused keyframes. Chrome remains a deterministic screenshot tool; ffmpeg creates motion from the screenshot sequence.

Keep constants local to the contract builder unless reuse becomes real:

- `CHAT_VISUAL_FPS = 30`
- `RIGHT_BUBBLE_IN_SEC = 0.23`
- `LEFT_BUBBLE_IN_SEC = 0.26`
- `READ_RECEIPT_DELAY_SEC = 0.05`
- `READ_RECEIPT_IN_SEC = 0.12`
- `READ_RECEIPT_OUT_SEC = 0.10`
- `LEFT_PRELUDE_SEC = 0.04`
- `HEADER_SWAP_SEC = 0.12`

## Decision (ADR-lite)

**Context**: The renderer screenshots static HTML frames. Browser runtime animation cannot reliably express song-timeline state because every frame starts from page load and `--virtual-time-budget=1000` is not tied to lyric timing.

**Decision**: Represent visual animation progress in `frame_contracts` and render paused CSS keyframes at that progress.

**Consequences**: This adds more frame contracts, but avoids runtime JS timelines, avoids new dependencies, keeps rendering deterministic, and keeps `scroll_windows` simple.

## Affected Scope

- Expected implementation targets:
  - `src/lib/chat-dialogue/chat-frame-contracts.ts`
  - `src/lib/chat-dialogue/chat-frame-html.ts`
  - `tests/chat-frame-contracts.test.ts`
- Usually unchanged:
  - `src/lib/chat-dialogue/chat-animation-plan.ts`
  - `src/lib/chat-dialogue/chat-frame-renderer.ts`
  - `src/lib/scheduler/v5-task-handlers.ts`
  - `tests/chat-animation-plan.test.ts`
  - `tests/chat-frame-renderer.test.ts`

## Out of Scope

- JS timeline controller.
- Changing Chrome virtual-time behavior to drive business animation.
- New animation/rendering dependencies.
- Reworking `scroll_windows`.
- Changing mux, manifest, timing pipeline, `video_chain`, external preview surfaces, or scheduler orchestration.
- Making 24fps/30fps configurable before a real performance need appears.

## Technical Notes

- Relevant specs read during task setup:
  - `.trellis/spec/guides/project-development.md`
  - `.trellis/spec/backend/index.md`
  - `.trellis/spec/backend/v4-chat-scheduler-contracts.md`
  - `.trellis/spec/backend/v5-control-plane-runner-contracts.md`
- `v4-chat-scheduler-contracts.md` applies to `src/lib/chat-dialogue/**` and chat frame artifacts.
- Existing tests already cover default avatar staging from `1.jpg`/`2.jpg`; this task should add coverage for the read-receipt avatar specifically.
