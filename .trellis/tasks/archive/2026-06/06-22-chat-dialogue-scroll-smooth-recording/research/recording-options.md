# Recording Options

## Current Evidence

- Current `projects/3test` evidence uses `capture_strategy: "cdp_seek_screenshots"`.
- MP4 metadata is already 60fps, so the visible roughness is not only container fps.
- Runtime `seekTimeline(timeSec)` lacks scroll state, so screenshot recording captures a static overflowing list instead of a moving chat viewport.
- It is not real screen recording because `renderChatRuntimeToVisual()` calls `captureRuntimeScreenshots()`, loops over every frame timestamp, calls `window.__qivanceChatRuntime.seek(index / fps)`, captures `Page.captureScreenshot`, writes `frame_%06d.png`, and then runs ffmpeg over that PNG sequence.
- Chrome currently runs headless with remote debugging. There is no X display, `x11grab`, desktop/window capture, or real-time playback recording in the production path.

## Option A: Keep CDP Seek Screenshots, Fix Runtime State

- Smallest change.
- Deterministic and fast relative to real-time recording.
- Needs explicit whole-chat-track scroll interpolation in `seekTimeline()` because screenshots do not let natural CSS/JS time run.
- Still writes PNG frames before ffmpeg encodes them.

## Option B: Record Chrome With Xvfb + ffmpeg

- Uses installed platform tools: `google-chrome`, `Xvfb`, `xvfb-run`, and ffmpeg `x11grab`.
- Records actual browser playback instead of screenshots.
- Better match for CSS animation and scroll smoothness.
- Costs real wall-clock duration for the video and needs process cleanup/error handling.
- No new npm dependency needed.

## Recommendation

Implement both in one narrow pass only if the user confirms non-screenshot recording is required now:

1. Fix runtime whole-chat-track upward slide, bottom reserve, and safety text first. This is required either way.
2. Switch production capture to Xvfb + ffmpeg if available.
3. Keep screenshot seek capture only as fallback/debug or test injectable path.

Ponytail note: do not add a third-party recorder library; installed Chrome/Xvfb/ffmpeg is enough.
