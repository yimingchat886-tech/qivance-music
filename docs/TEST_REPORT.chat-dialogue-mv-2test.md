# TEST_REPORT `chat_dialogue_mv` `2test` real assets

Date: 2026-06-20
Task: `.trellis/tasks/06-20-chat-dialogue-mv-2test/prd.md`

## Summary

This report records the real-asset `chat_dialogue_mv` validation run for `projects/2test`.

Result: **passed**.

What passed:

- `projects/2test` was registered as a DB-backed V5 `chat_dialogue_mv` project.
- The real lyrics and MP3 were stored as active control-plane inputs.
- Stable locked inputs were materialized:
  - `lyrics.md`
  - `active_music_take.mp3`
- Audio analysis produced:
  - `data/timing/beat_grid.json`
  - `data/timing/onset_events.json`
  - `data/timing/energy_curve.json`
- WhisperX alignment produced `data/timing/lyric_word_timing.json`.
- `section_map.json`, conversation plan, frame HTML, visual render, mux, QA, and manifest all completed.
- `exports/chat_dialogue_mv/final.mp4` was produced.
- Focused chat tests passed.
- V5 backend regression tests passed.
- TypeScript typecheck passed.

Resolved blockers:

- Earlier runs timed out while downloading/initializing WhisperX cache.
- After the repo-local cache fix, timing passed and exposed a Chinese no-whitespace line coverage bug.
- The line coverage bug was fixed by matching Chinese WhisperX chunks at token level.

## Test Inputs

Source folder:

```text
projects/2test
```

Input files:

| File | Size | SHA-256 |
|---|---:|---|
| `歌词.md` | 1,595 bytes | `12cce0a269f2475a57af63d619c47316c805daac7a1b1136889f9021bd0cc675` |
| `纸飞机_no-watermark.mp3` | 4,686,461 bytes | `336cdd9b1b0e88623bbaf5045ee781ce5eaba632d177436b2793d5a82e46c8a4` |
| `1.jpg` | 300,973 bytes | `cba95167fcbfcc1cea19b1482a26e5b179cc574125914a269e28c78386f1c71a` |
| `2.jpg` | 120,091 bytes | `eb713aa63dc44d010958984eb224662aafe8369f7aec9b1cbd5d53f1d210a9cb` |

Audio probe:

```json
{
  "codec_name": "mp3",
  "sample_rate": "44100",
  "channels": 2,
  "duration": "146.390204"
}
```

`projects/2test/纸飞机_no-watermark.mp3:Zone.Identifier` was ignored.

## Execution

Local V5 registration and run command shape:

```bash
TMPDIR=/tmp \
NUMBA_CACHE_DIR=/tmp/numba-cache \
QIVANCE_WHISPERX_DEVICE=cpu \
QIVANCE_WHISPERX_REQUIRE_GPU=0 \
QIVANCE_WHISPERX_LANGUAGE=zh \
QIVANCE_WHISPERX_MODEL=tiny \
QIVANCE_WHISPERX_CACHE_DIR=/home/jym/workspace/qivance-music/.cache/huggingface \
QIVANCE_WHISPERX_TIMEOUT_MS=<timeout> \
node --experimental-strip-types -e '<create/register 2test, upload real lyrics/audio, confirm V5 inputs, run createV5TaskHandlers scheduler loop>'
```

The command used existing source functions:

- `createV5Project`
- `uploadV5ProjectInputs`
- `confirmV5ProjectInputs`
- `runV5SchedulerOnce`
- `createV5TaskHandlers`

No fake media dependencies were used.

Scheduler runs:

| Run | Mode | Status | Result |
|---|---|---|---|
| `run_1a57f9d353704b8c` | `production` | `blocked` | WhisperX timed out after `180000ms` |
| `run_957cbb2fd5844c23` | `production` | `blocked` | WhisperX timed out after `600000ms` |
| `run_77a984fa1dc24b8e` | `production` | `failed` | `build_conversation_plan` failed on Chinese no-whitespace line coverage |
| `run_faa1e8d253db4b51` | `production` | `passed` | Full chain completed |

Latest run task state:

| Stage | Status | Error |
|---|---|---|
| `run_timing_pipeline` | `passed` |  |
| `build_lyrics_line_map` | `passed` |  |
| `build_speaker_attribution` | `passed` |  |
| `build_conversation_plan` | `passed` |  |
| `build_chat_frames` | `passed` |  |
| `render_visual` | `passed` |  |
| `mux_final` | `passed` |  |
| `qa_report` | `passed` |  |
| `write_manifest` | `passed` |  |

## Artifact Evidence

Generated:

| Artifact | Status |
|---|---|
| `lyrics.md` | present |
| `active_music_take.mp3` | present |
| `inputs/lyrics/input_b0a16344e6064fcd.md` | present |
| `inputs/audio/input_2c43dac98fcb42a3.mp3` | present |
| `data/timing/beat_grid.json` | present |
| `data/timing/onset_events.json` | present |
| `data/timing/energy_curve.json` | present |
| `data/timing/lyric_word_timing.json` | present |
| `data/timing/section_map.json` | present |
| `data/chains/chat_dialogue_mv/conversation_plan.json` | present |
| `video/html-video/.html-video/projects/2test/assets/avatars/1.jpg` | present |
| `video/html-video/.html-video/projects/2test/assets/avatars/2.jpg` | present |
| `data/chains/chat_dialogue_mv/qa_report.json` | present, status `passed` |
| `exports/chat_dialogue_mv/final.mp4` | present, 6,452,119 bytes |
| `exports/chat_dialogue_mv/render_manifest.json` | present, production non-diagnostic |

Final output paths:

```text
projects/2test/exports/chat_dialogue_mv/final.mp4
projects/2test/exports/chat_dialogue_mv/render_manifest.json
projects/2test/data/chains/chat_dialogue_mv/qa_report.json
```

## Verification Commands

Passed:

```bash
npm run typecheck
```

```bash
TMPDIR=/tmp node --experimental-strip-types --test \
  tests/chat-speaker-attribution.test.ts \
  tests/chat-conversation-plan.test.ts \
  tests/chat-frame-contracts.test.ts \
  tests/chat-animation-plan.test.ts
```

```bash
npm run test:v5
```

Real production run:

```bash
TMPDIR=/tmp NUMBA_CACHE_DIR=/tmp/numba-cache \
QIVANCE_WHISPERX_CACHE_DIR=/home/jym/workspace/qivance-music/.cache/huggingface \
QIVANCE_WHISPERX_DEVICE=cpu \
QIVANCE_WHISPERX_REQUIRE_GPU=0 \
QIVANCE_WHISPERX_LANGUAGE=zh \
QIVANCE_WHISPERX_MODEL=tiny \
QIVANCE_WHISPERX_TIMEOUT_MS=900000 \
node --experimental-strip-types -e '<real 2test V5 scheduler run>'
```

Final MP4 probe:

```json
{
  "video": { "codec_name": "h264", "width": 1080, "height": 1920 },
  "audio": { "codec_name": "aac", "sample_rate": "44100", "channels": 2 },
  "duration": "146.433333"
}
```

QA summary:

```json
{
  "status": "passed",
  "audio_stream_count": 1,
  "duration_drift_ms": 43
}
```

Conversation summary:

```json
{
  "messages": 53,
  "right": 15,
  "left": 38,
  "badRight": 0,
  "badLeft": 0
}
```

## Acceptance Matrix

| Acceptance check | Result | Notes |
|---|---|---|
| Question punctuation maps to right/questioner | passed | Covered by focused tests and real `歌词.md` fixture |
| Non-question lines map to left/answerer | passed | Covered by focused tests and real `歌词.md` fixture |
| 2test classification yields 15 right-side questions | passed | `tests/chat-speaker-attribution.test.ts` |
| Question words without punctuation do not create questions | passed | Focused test |
| Consecutive non-question lyrics remain left-side | passed | Focused test |
| `questioner` -> `right`, `answerer` -> `left` validation | passed | Focused test |
| Conversation plan still enforces speaker/side match | passed | Existing focused tests |
| Avatar staging from `1.jpg`/`2.jpg` | passed | Assets copied and byte-compared |
| Header title rule | passed | Focused frame test |
| Read receipt visible-state rule | passed | Focused frame test |
| `npm run typecheck` | passed | |
| Focused chat tests | passed | 15 tests passed |
| `npm run test:v5` | passed | 26 tests passed |
| Production final MP4 | passed | `exports/chat_dialogue_mv/final.mp4` |
| Production manifest | passed | schema v4, non-diagnostic |
| QA report | passed | one audio stream, 43 ms drift |

## Notes

The latest blocker was not timing after the repo-local cache fix. It was `buildLineTimings` treating Chinese no-whitespace lyric lines as one word while WhisperX returned short Chinese chunks. The production fix keeps the same `lyric_word_timing` source and matches Chinese chunks by normalized token sequence.
