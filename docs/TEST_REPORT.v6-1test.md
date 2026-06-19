# TEST_REPORT v6 `1test` real asset video_chain

Date: 2026-06-17
Branch: `codex/planv5-track-trellis-files`
Latest implementation commit: `2b7403a Implement V6 video chain workflow`

## Summary

This report records a real-asset validation run for `video_chain` using the local `projects/1test` folder. The test used the local-import path instead of the HTTP multipart upload path because the real MP4 is larger than the current upload body limit.

Result: **blocked, not passed**.

What passed:

- `projects/1test` was registered as a DB-backed `video_chain` project.
- The real lyrics, MP3, and MP4 were stored as active control-plane inputs.
- Stable locked input paths were materialized:
  - `lyrics.md`
  - `active_music_take.mp3`
  - `source_video.mp4`
- MP4 source import succeeded and recorded `audio_policy: background_video_only`.
- Audio analysis produced beat, onset, and energy artifacts after setting a writable Numba cache directory.
- Workbench/API project detail and the V6 video-chain page rendered the blocked project state.

What did not pass:

- `run_timing_pipeline` never produced `lyric_word_timing.json`.
- `section_map.json` was not generated.
- Downstream html-video frame generation, visual render, mux, QA, and manifest stages did not run.
- No final MP4 was produced.

## Test Inputs

Source folder:

```text
projects/1test
```

Input files:

| File | Size | Probe summary |
|---|---:|---|
| `歌词.md` | 1,551 bytes | Lyrics markdown |
| `AI智能体_no-watermark.mp3` | 3,749,397 bytes | MP3 audio, duration `117.106939s` |
| `ai_agent_lyric_9x16_final.mp4` | 112,060,024 bytes | H.264 video `1080x1920`, AAC audio, duration `117.095011s` |

The MP4 is larger than the current HTTP multipart read limit:

```text
MP4 size: 112,060,024 bytes
Current multipart limit: 104,857,600 bytes
```

Therefore this validation used a temporary local script under `/tmp` to call existing project functions directly. No repo source file was changed for the test execution.

## Execution

Preflight checks:

- `pwd` and Git root both resolved to `/home/jym/workspace/qivance-music`.
- `git status --short` was clean before the run.
- `projects/qivance_control.sqlite` had no existing `id='1test'` project record.
- `ffmpeg` and `ffprobe` were available.
- `.venv/bin/python`, `librosa`, `whisperx`, Node `v24.14.0`, and `@html-video/runtime` with the `codex` agent were available.

Local import and confirmation:

- Created DB project:

```text
id: 1test
title: 1test real video_chain
content_type: video_chain
status: blocked
project_root: /home/jym/workspace/qivance-music/projects/1test
```

- Active inputs:

| Kind | Original name | Stored path | Stable path | SHA prefix |
|---|---|---|---|---|
| `audio` | `AI智能体_no-watermark.mp3` | `inputs/audio/active_music_take_20260617100649.mp3` | `active_music_take.mp3` | `36dfec40c008e7be` |
| `lyrics` | `歌词.md` | `inputs/lyrics/lyrics_20260617100649.md` | `lyrics.md` | `a111ce39e2603eb0` |
| `video` | `ai_agent_lyric_9x16_final.mp4` | `inputs/video/source_video_20260617100649.mp4` | `source_video.mp4` | `b9bfd83f81ba3a91` |

Scheduler runs:

| Run | Status | Started | Finished | Blocking point |
|---|---|---|---|---|
| `run_2bcd3315d9614f5f` | `blocked` | `2026-06-17T10:06:49.746Z` | `2026-06-17T10:06:51.610Z` | `librosa` / `numba` cache error |
| `run_9ca1c03d4e6f4b66` | `blocked` | `2026-06-17T10:08:26.686Z` | `2026-06-17T10:10:21.018Z` | Hugging Face DNS/model resolution failure under restricted network |
| `run_955d4470ed3d4ae7` | `blocked` | `2026-06-17T10:10:51.090Z` | `2026-06-17T10:20:53.545Z` | WhisperX timed out after `600000ms` |

The retry environment used:

```bash
TMPDIR=/tmp
NUMBA_CACHE_DIR=/tmp/numba-cache
QIVANCE_WHISPERX_DEVICE=cpu
QIVANCE_WHISPERX_REQUIRE_GPU=0
QIVANCE_WHISPERX_LANGUAGE=zh
QIVANCE_WHISPERX_MODEL=tiny
QIVANCE_WHISPERX_TIMEOUT_MS=600000
QIVANCE_WHISPERX_CACHE_DIR=/tmp/qivance-whisperx-cache
```

## Artifact Evidence

Generated artifacts:

| Artifact | Status |
|---|---|
| `data/source/source_video_import.json` | present |
| `data/timing/beat_grid.json` | present |
| `data/timing/onset_events.json` | present |
| `data/timing/energy_curve.json` | present |
| `data/timing/alignment_report.json` | present, status `failed` |
| `data/timing/lyric_word_timing.json` | missing |
| `data/timing/section_map.json` | missing |
| `data/chains/video_chain/video_animation_plan.json` | missing |
| `data/chains/video_chain/frame_contracts.json` | missing |
| `exports/video_chain/visual.mp4` | missing |
| `exports/video_chain/final.mp4` | missing |
| `data/chains/video_chain/qa_report.json` | missing |
| `exports/video_chain/render_manifest.json` | missing |

`data/source/source_video_import.json` confirmed:

```json
{
  "source_video": {
    "path": "source_video.mp4",
    "duration_sec": 117.095,
    "width": 1080,
    "height": 1920,
    "video_codec": "h264",
    "audio_streams": 1,
    "audio_codec": "aac"
  },
  "audio_policy": "background_video_only",
  "status": "locked"
}
```

`data/timing/alignment_report.json` ended with:

```json
{
  "backend": "whisperx",
  "status": "failed",
  "model": {
    "name": "tiny",
    "device": "cpu",
    "cache_dir": "/tmp/qivance-whisperx-cache"
  },
  "diagnostics": [
    "The chosen align_model \"jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn\" could not be found in huggingface (https://huggingface.co/models) or torchaudio (https://pytorch.org/audio/stable/pipelines.html#id14)"
  ],
  "gpu": {
    "cuda_available": false
  }
}
```

The latest scheduler task error for `run_955d4470ed3d4ae7` was:

```text
timing_blocked: WhisperX alignment could not produce lyric_word_timing.json: WhisperX runner timed out after 600000ms
```

## UI/API Verification

A temporary dev server was started with runner disabled:

```bash
HOST=127.0.0.1
PORT=3002
QIVANCE_V5_RUNNER=0
QIVANCE_PROJECTS_ROOT=/home/jym/workspace/qivance-music/projects
npm run dev
```

Endpoint results:

| Endpoint | Status | Result |
|---|---:|---|
| `/api/projects/1test` | `200` | Returned project status `blocked`, 3 inputs, 3 runs |
| `/projects/1test/video-chain` | `200` | Rendered V6 video-chain page with blocked run details |
| `/api/projects/1test/chains/video-chain/preview` | `500` | Missing html-video `project.json` because frame build did not run |
| `/api/projects/1test/chains/video-chain/export/final.mp4` | `404` | Final MP4 not produced |

The temporary server on port `3002` was stopped after verification. Existing port `3001` service was not touched.

## Acceptance Matrix

| Acceptance check | Result | Notes |
|---|---|---|
| DB project `1test` uses `content_type=video_chain` | passed | Control-plane row created |
| Confirm creates 7 scheduler tasks | passed | Each run had 7 tasks |
| Active lyrics/audio/video inputs exist | passed | All 3 active inputs recorded |
| Stable paths are materialized | passed | `lyrics.md`, `active_music_take.mp3`, `source_video.mp4` exist |
| `source_video_import.json` uses `background_video_only` | passed | MP4 locked as visual background |
| `beat_grid.json` generated | passed | Produced by audio analysis |
| `onset_events.json` generated | passed | Produced by audio analysis |
| `energy_curve.json` generated | passed | Produced by audio analysis |
| `lyric_word_timing.json` generated | failed | WhisperX did not complete |
| `section_map.json` generated | failed | Depends on lyric word timing |
| html-video frame contracts generated | not reached | Blocked before `prepare_video_context` |
| final MP4 generated | not reached | Blocked before render/export |
| render manifest proves MP3 final audio policy | not reached | No final manifest |

## Root Cause

The tested `video_chain` path is currently blocked by the timing dependency, not by MP4 import or project registration.

Observed blockers:

1. `librosa` failed when Numba attempted to cache from the virtualenv package path.
   - Mitigation used: `NUMBA_CACHE_DIR=/tmp/numba-cache`.
   - Result: audio analysis then produced beat/onset/energy artifacts.

2. WhisperX Chinese alignment required Hugging Face model resolution.
   - Restricted network run failed DNS resolution for `huggingface.co`.
   - Network-escalated run progressed further but ultimately timed out after 600 seconds.
   - `alignment_report.json` records failed status and the Chinese align model diagnostic.

## Conclusion

The real `1test` assets are valid enough to enter the V6 control plane:

- MP3 and MP4 are readable by `ffprobe`.
- MP4 import succeeds and preserves the V6 audio policy: MP4 is background video only, MP3 remains final master audio.
- DB-backed input registration and scheduler task creation work.

The full chain did **not** pass because timing did not produce `lyric_word_timing.json` and `section_map.json`. As a result, html-video preview, final render/export, QA, and render manifest were not exercised in this run.

## Recommended Next Steps

1. Make WhisperX alignment reproducible for Chinese real-audio tests:
   - pre-warm or vendor the required Chinese alignment model cache; or
   - configure a known available Chinese align model; or
   - add a controlled local/offline alignment fallback for smoke validation that is explicitly marked non-production.

2. Increase the HTTP multipart upload limit or add a local-file/import path for large MP4 inputs, because the real MP4 is larger than the current 100 MiB request limit.

3. After timing is unblocked, rerun `1test` from confirmation and verify:
   - `section_map.json`;
   - html-video `project.json` and frame contracts;
   - preview endpoint;
   - `exports/video_chain/final.mp4`;
   - render manifest audio policy and final audio stream count.

## Files Touched

Docs-only report added:

```text
docs/TEST_REPORT.v6-1test.md
```

No source code, tests, config, package files, lockfiles, schemas, routes, or build files were modified for this report.
