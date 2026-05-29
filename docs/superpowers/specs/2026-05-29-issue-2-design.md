# Issue #2 Design: Storyboard Import, Gate Progress, and Embedded HyperFrames UI

## Context

Issue #2 builds on the current post-MiniMax MVP. The existing app already imports accepted audio, locks music, generates beat/timing/storyboard artifacts, creates a `hypeframes/` project, and renders fallback preview MP4s. This design keeps that pipeline, but changes the human-facing review surface:

- external LLMs may produce the storyboard script;
- gate state must be visible instead of hidden in JSON downloads;
- the official HyperFrames CLI Web UI becomes the preview/review surface;
- the old Qivance inline `<video>` preview is removed.

## Assumptions

1. The branch starts from `codex/issue1-audio-upload-sqlite`, so uploaded audio and project-local audio materialization are available.
2. "HyperFrames UI" means the official/CLI-provided local Web UI, not a Qivance reimplementation.
3. Qivance may start a HyperFrames child process on demand.
4. LAN users must be able to access the HyperFrames child process for the current project.
5. The current MVP remains local-first. No raw source audio, pasted script, or generated project files are uploaded to a remote service by this change.

## Success Criteria

1. A user can paste externally generated storyboard JSON into a project and have it written into the normal storyboard artifact paths.
2. Imported storyboard data is checked by the same light storyboard gate used by generated storyboard data.
3. The project page shows a clear progress bar for Music Ingest, Beat Lock, Timing Schema Gate, Storyboard Gate, HypeFrames generation, and Preview Review readiness.
4. Timing Schema Gate failure is visible on the page with blocking issues.
5. A user can start the HyperFrames CLI Web UI for the current project from Qivance.
6. The embedded HyperFrames UI is reachable from another machine on the LAN when Qivance itself is accessed over the LAN.
7. The old Qivance preview `<video>` panel is gone; review happens through HyperFrames UI or its direct LAN URL.

## Architecture

Add three small boundaries instead of expanding route logic inline:

1. `storyboard-import` module
   Parses pasted JSON, validates the minimum storyboard shape, writes `scene_plan.json`, `caption_plan.json`, and `visual_plan.json`, then records a QA report.

2. `gate-progress` module
   Reads existing manifests and QA reports and returns a render-friendly list of gate steps with `pending`, `running`, `pass`, `warning`, or `fail` status.

3. `hyperframes-ui` module
   Owns child-process startup, port selection, process reuse, LAN URL construction, and runtime status persistence for the official HyperFrames UI.

The HTTP server remains the only route owner. It calls these modules from focused routes:

- `POST /projects/:id/storyboard/import`
- `POST /projects/:id/hyperframes-ui/start`
- `GET /projects/:id/hyperframes-ui/status`

## Storyboard Import / Paste Window

The project workspace gets a paste form in the storyboard area. The user pastes JSON generated outside Qivance. The accepted minimum shape is:

```json
{
  "scenes": [],
  "captions": [],
  "visuals": []
}
```

Validation is intentionally light:

- `scenes` must be an array.
- Each scene must have `scene_id`, `section_id`, `start_sec`, and `end_sec`.
- Times must be finite numbers, non-negative, and `end_sec > start_sec`.
- Scene ranges must not overlap.
- Captions, when present, must have finite `start_sec`, `end_sec`, and text.
- Visuals, when present, must have `scene_id`.

On pass, Qivance writes:

- `data/storyboard/scene_plan.json`
- `data/storyboard/caption_plan.json`
- `data/storyboard/visual_plan.json`
- `qa/storyboard/scene_rule_check.json`

The workflow state becomes `scene_waiting_human`, matching the existing approval path. On fail, the pasted data is not written to canonical artifact paths; the UI shows blocking issues.

## Music Lock / Audio Ingest Progress

The current audio ingest implementation remains the source of truth. The UI adds a stage progress bar based on artifacts and QA reports:

1. Music Ingest
2. Beat Lock
3. Timing Schema Gate
4. Storyboard Gate
5. HypeFrames Project
6. HyperFrames UI / Preview Review

Each stage is derived from existing files such as:

- `qa/music/music_ingest_qa_report.json`
- `qa/timing/beat_lock_qa_report.json`
- `qa/timing/timing_qa_report.json`
- `qa/storyboard/scene_rule_check.json`
- `qa/hypeframes/hypeframes_file_qa_report.json`
- `logs/hyperframes_ui.json`

No new workflow state is required for progress display.

## Timing Schema Gate

The existing timing QA stays blocking. The UI must surface:

- status;
- blocking issues;
- warnings;
- `section_map.json` summary;
- whether `audio_hash` matches the locked audio hash.

If Timing Schema Gate fails, the primary action remains rerun/rebuild timing. Storyboard import and HypeFrames generation remain disabled until timing passes.

## Storyboard Light Rule Gate

Generated and pasted storyboard plans both use the same gate report path: `qa/storyboard/scene_rule_check.json`.

The gate remains light and deterministic. It checks numeric timing, overlap, minimal required fields, section coverage, and caption time sanity. It does not judge creative quality.

## Embedded HyperFrames UI

Qivance starts the official HyperFrames CLI Web UI as a child process for the current project directory:

- working directory: `<project>/hypeframes`;
- host: default `0.0.0.0` for LAN access;
- port: auto-selected free port unless a valid existing process is reusable;
- process metadata: `logs/hyperframes_ui.json`;
- public URL: built from the current request host when possible, otherwise from the first private LAN IPv4 address.

The project page embeds the UI in an iframe using the LAN-capable URL. It also shows the direct URL because iframe embedding may be blocked by the HyperFrames UI's own headers.

The old Qivance preview `<video>` panel is removed. Qivance can still keep generated MP4 artifacts and download links, but it no longer presents the incomplete built-in preview as the review window.

## LAN Access Rules

The HyperFrames child process must be reachable by LAN users, but only for the project that started it:

- Qivance never accepts an arbitrary filesystem path from the browser.
- The project id is resolved under `storageRoot`.
- The child process starts only after `hypeframes/src/index.html` exists.
- The runtime record includes `project_id`, `pid`, `port`, `host`, `url`, and `started_at`.
- If the process exits, the status endpoint reports it as stopped and the UI offers restart.

## Error Handling

Errors are shown as explicit page messages:

- invalid storyboard JSON;
- storyboard gate blocking issues;
- missing HypeFrames project files;
- HyperFrames CLI not installed or not runnable;
- port allocation failure;
- child process exited;
- iframe blocked, with direct URL still shown.

The app should not silently fall back to the old Qivance video preview.

## Testing

Add focused tests before implementation:

1. Storyboard import rejects overlapping or non-finite scene times.
2. Storyboard import writes canonical storyboard artifacts on valid input.
3. Gate progress maps QA reports into stage statuses.
4. Workspace HTML includes the progress bar and paste form.
5. Workspace HTML does not include the old preview `<video>` panel.
6. HyperFrames UI starter builds a LAN-capable URL and persists runtime metadata.
7. Server routes reject invalid project ids and missing HypeFrames files.

End-to-end verification should run `npm test`. If implementation changes indexed symbols, run GitNexus impact analysis before editing and `npx gitnexus detect-changes --repo qivance-music` before commit.

## Out of Scope

- Building a custom HyperFrames editor inside Qivance.
- Editing beats on a waveform.
- Replacing the HyperFrames CLI renderer.
- Uploading local source assets to a remote service.
- Adding authentication or team permissions.
