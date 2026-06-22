# Oracle Review: Chat Scroll Smooth Recording

## Session

- Oracle session: `qivance-chat-scroll-smooth-recording-3`
- Transcript: `/home/jym/.oracle/sessions/qivance-chat-scroll-smooth-recording-3/artifacts/transcript.md`
- Uploaded package: 16 files, no MP4, about 588 KB in dry-run.

## Key Findings

- The PRD is directionally correct, but must make the fixed header/status boundary explicit and avoid letting runtime seek and normal playback use separate animation models.
- Current capture is not real recording because production calls CDP seek per frame, captures `Page.captureScreenshot`, writes PNG files, then encodes them with ffmpeg.
- The immediate smoothness problem is not the PNG sequence itself. The bigger bug is that `seekTimeline(timeSec)` lacks whole-track scroll interpolation, so every captured 60fps frame has the wrong state.

## Recommended Animation Model

- Use a fixed shell plus a movable track:
  - `.top` / header remains fixed.
  - `.chat-viewport` clips the chat area.
  - `.chat-track` contains the time marker, rows, and bottom spacer.
- Move the whole `.chat-track` with `transform: translate3d(0, ypx, 0)`, not `scrollTop`.
- Put the time marker inside `.chat-track` so it scrolls with messages.
- Use bottom anchoring: latest row bottom plus track offset must stay above `viewportHeight - bottomReservePx`.
- Suggested bottom reserve: 240-320px.
- Suggested scroll segment duration: 0.28-0.42s with `cubic-bezier(.20, .80, .20, 1)`.
- Pre-reserve read receipt height to avoid row-height jumps.
- Round trackY to device pixels to avoid shimmer.
- Do not use CSS transition on `.chat-track`; deterministic seek needs exact per-frame state.

## Recommended Recorder Priority

1. Keep deterministic CDP seek screenshots after adding correct track interpolation.
   - Most reproducible, exact 60fps timestamps, easiest to test.
2. Add `Xvfb + ffmpeg x11grab` only as optional or later production strategy.
   - More like real playback, but can drop/repeat frames and adds process cleanup risk.
3. Avoid new recorder dependencies, `Page.startScreencast`, or large framework changes.

## Minimum Change Path

1. `src/lib/chat-dialogue/chat-runtime-html.ts`
   - Remove safety notice.
   - Add viewport/track DOM.
   - Implement shared `renderAt(timeSec)` or equivalent.
   - Make both `seek()` and `play()` use the same state model.
2. `tests/chat-runtime-html.test.ts`
   - Assert no safety notice.
   - Assert track/viewport/bottom reserve/transform logic exists.
3. `src/lib/chat-dialogue/chat-frame-html.ts`
   - Remove fallback safety notice and validator requirement.
4. `tests/chat-frame-contracts.test.ts`
   - Flip old safety notice assertions to no-safety-notice assertions.
5. Update recorder/spec tests only if capture strategy contract changes.

## Critical Details For WeChat/Douyin-Level Smoothness

- Single time function controls bubble enter, read receipt, typing state, and trackY.
- Whole chat track moves; individual bubbles only keep local pop/opacity.
- Latest message is anchored to bottom reserve, not left to natural overflow.
- Bottom spacer and read receipt space are preallocated.
- Deterministic per-frame interpolation matters more than naming the method "real recording".
