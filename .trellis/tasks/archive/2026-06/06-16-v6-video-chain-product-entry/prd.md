# Implement V6 video_chain product entry

## Goal

Implement V6 so an internal operator can create a project, open a dedicated V6/video-chain input page, upload MP4, MP3, and lyrics, generate timing/section map from the uploaded audio and lyrics, then run a DB-backed `video_chain` into html-video and export a final MP4.

## What I Already Know

* V5 is committed as `a06bb9d Implement PLANv5 product entry`.
* V5 added DB-backed project creation, lyrics/audio upload, input confirmation, SQLite/Prisma control plane, server runner loop, and `chat_dialogue_mv` execution.
* V5 registry currently enables only `chat_dialogue_mv`; V5 docs record `video_chain` as the next-version direction.
* V3 already has a file-backed source MP4 path with source video import, locked local video evidence, source-video agent context, html-video frame validation, render/export, and manifest evidence.
* V6 should combine the V5 DB-backed runner with the V3 source-video/html-video production path.
* User requested a new subpage after project creation where the operator submits MP4, MP3, and lyrics, then generates `section_map`, then enters html-video.
* User confirmed the uploaded MP3 is the final audio source.
* User confirmed the uploaded MP4 is the background video inside html-video.
* User wants html-video to create knowledge-card style motion graphics over the MP4 background.
* User will connect real testing after this change, so V6 success must prove the html-video step actually runs.
* User requires a subpage UI for V6 inputs, preview, render/export, and LLM-driven effect revision.

## Decisions

* Uploaded MP3 is the locked master audio for timing and final mux.
* Uploaded MP4 is a locked local background video for html-video frames, not the final audio source.
* html-video frames should use the MP4 as a full-frame background layer and animate knowledge cards / teaching callouts above it.
* The V6 happy path must use the real html-video agent/runtime path for acceptance; mocked or deterministic fallback behavior can be used in unit tests but cannot count as product success.
* The V6 subpage must support chat-style LLM revision of the visual effect after initial html-video generation.
* LLM revision only refreshes the html-video preview; it must not automatically re-render/export `final.mp4`.
* Final MP4 generation remains an explicit Render/Export action after the user is satisfied with preview revisions.
* `section_map` is generated from MP3 + lyrics through the existing V5 timing pipeline.
* `video_chain` should be a first-class chain registry entry, not a diagnostic mode or manual V3-only route.
* Existing `chat_dialogue_mv` behavior must remain compatible.

## Open Questions

* None blocking. Remaining details should follow existing V3/V5 contracts unless implementation exposes a concrete conflict.

## Requirements (Evolving)

* Add `video_chain` to the chain registry as a V6-enabled chain.
* Allow creating a V6 `video_chain` project through the existing project creation path or an equivalent Workbench control.
* Add a dedicated V6/video-chain input subpage for a newly created project.
* The subpage must include:
  * MP4 / MP3 / lyrics upload controls;
  * confirm inputs / run status controls;
  * html-video preview iframe or equivalent embedded preview;
  * run/task/event status and error display;
  * a chat-style LLM revision panel;
  * final render/export links.
* Support uploading:
  * lyrics text or `.md` / `.txt` lyrics file;
  * `.mp3` / `.wav` master audio;
  * `.mp4` source video.
* Store uploaded files as immutable project inputs with sha256, mime, original filename, stable path, and DB metadata.
* Materialize stable compatibility paths after confirmation:
  * `lyrics.md`;
  * `active_music_take.mp3`;
  * a locked source video path plus `data/source/source_video_import.json`.
* Confirmation must require active lyrics, active audio, and active source video for `video_chain`.
* Confirmation must create a scheduler run and tasks without manual scheduler tick routes.
* Runner must generate timing artifacts, including `data/timing/section_map.json`, before html-video work starts.
* Runner must enter html-video with the locked MP4 available as a local background video asset and the generated timing context available in agent context.
* html-video frame contracts / agent context must instruct the agent to keep the MP4 as a background layer and place knowledge-card animations, captions, keywords, and teaching callouts above it.
* Initial html-video generation must create real frame HTML through the html-video agent/runtime path and record agent run evidence.
* The LLM revision panel must send user effect-change instructions to a real html-video revision/agent path, persist the revision request and agent run log, then refresh preview on success.
* LLM revision must not automatically trigger final render/export; final MP4 remains stale until the user explicitly runs Render/Export.
* Revision requests must preserve locked MP4 background, MP3 final audio policy, strict duration, local-asset-only constraints, and frame validation.
* The MP4 background should be treated as visual-only for final delivery; its audio must not replace the uploaded MP3.
* Runner must produce chain-scoped artifacts under `data/chains/video_chain/**` and `exports/video_chain/**`.
* Final export must produce final MP4, QA report, and render manifest with DB artifact rows.
* Workbench must show V6/video-chain inputs, run/task/event status, failure reasons, and final artifact links.
* Existing `chat_dialogue_mv` V5 project input, runner, and Workbench flows must not regress.

## Acceptance Criteria (Evolving)

* [ ] `video_chain` is accepted by project creation and rejected only when unsupported by explicit validation.
* [ ] `chat_dialogue_mv` remains supported and existing V5 tests still pass.
* [ ] A V6 project can be created and opened in a dedicated video-chain input page.
* [ ] The input page accepts MP4, MP3/WAV, and lyrics text/file upload.
* [ ] The subpage includes preview, run/error status, final artifact links, and a chat-style LLM revision panel.
* [ ] Confirming inputs before all required inputs exist fails with a clear error.
* [ ] Confirming complete inputs creates a queued scheduler run with `video_chain` tasks.
* [ ] Scheduler generates `beat_grid.json`, `onset_events.json`, `energy_curve.json`, `lyric_word_timing.json`, `alignment_report.json`, and `section_map.json`.
* [ ] html-video agent context references the locked source MP4 as a background video and references generated timing artifacts.
* [ ] The V6 happy-path test records a successful real html-video agent/runtime run; fallback or mock output is not counted as acceptance evidence.
* [ ] Generated/validated frame HTML places knowledge-card style motion graphics above the MP4 background.
* [ ] A user can submit an LLM revision instruction from the V6 subpage and see the preview refresh after the agent succeeds.
* [ ] LLM revision does not automatically re-render/export `final.mp4`; final export is triggered by an explicit Render/Export action.
* [ ] Frame validation rejects remote video, temporary paths, and unregistered MP4 references.
* [ ] Export writes `exports/video_chain/final.mp4`, `exports/video_chain/render_manifest.json`, and a QA report.
* [ ] Final MP4 audio comes from uploaded MP3, not from the MP4 background video.
* [ ] Final manifest validates locked input sha values against DB rows.
* [ ] A V6 E2E script covers create -> upload MP4/MP3/lyrics -> confirm -> timing -> html-video -> final MP4.

## Definition of Done

* Tests added or updated for registry, inputs, runner task handlers, Workbench API/HTML, and V6 E2E.
* `npm run typecheck` passes.
* Focused backend contract tests pass.
* V5 regression coverage for `chat_dialogue_mv` passes.
* `git diff --check` passes.
* Docs/test report updated with V6 evidence.
* GitNexus impact checks are run before source symbol edits and detect-changes is run before commit.

## Out of Scope (Explicit)

* SaaS, auth, users, permissions, Cloudflare Access, or Tailscale.
* DeepSeek lyric generation.
* MiniMax music generation.
* Multi-take audio selection UI beyond the uploaded master audio.
* `image_storyboard_mv`.
* RAG asset pool, Obsidian import, source capsule generation, and template marketplace.
* Next.js/OpenDesign rewrite or high-fidelity UI redesign.
* Multi-process/distributed runner locking.

## Technical Approach (Initial)

1. Generalize V5 chain registry and input lifecycle from `chat_dialogue_mv` only to chain-specific requirements.
2. Add source-video input support to the V5/V6 control-plane upload path, reusing `src/lib/video-html/source-video-import.ts` where practical.
3. Add `video_chain` scheduler stages: timing, source background-video context preparation, knowledge-card html-video frame build, visual render, MP3 final mux, QA, and manifest.
4. Reuse V3 source-video html-video contracts, V3 revision-agent flow, and V5 runner/task/event persistence.
5. Add a minimal Workbench subpage rather than a frontend rewrite, with a chat-style revision panel bound to the real html-video revision path.

## Decision (ADR-lite)

**Context**: V3 source-video mode preserves MP4 source audio, while V6 requires uploading both MP4 and MP3 before entering html-video.

**Decision**: V6 `video_chain` treats MP4 as a locked background video layer and MP3 as the sole final master audio. html-video creates knowledge-card / teaching-card animation layers over the background video. Real html-video agent/runtime execution is required for V6 acceptance, and the V6 subpage must expose LLM revision chat for effect changes. LLM revisions refresh the html-video preview only; final MP4 export remains an explicit user action.

**Consequences**: V6 can reuse source-video validation, frame-video safety gates, and existing revision machinery, but it must not reuse V3's `preserve_source_audio` policy for final export. The render manifest and QA report must prove final audio comes from the uploaded MP3. Real-test readiness is part of the feature, so E2E evidence must distinguish real html-video runtime from mocks/fallbacks.

## Expansion Sweep

### Future Evolution

* `video_chain` can later support source MP4 semantic analysis and automatic storyboard reconstruction.
* Chain-specific input requirements should preserve room for future chains without reworking the ProjectInput model again.

### Related Scenarios

* Existing V3 source-video manual/API route should remain compatible or be routed through V6 where possible.
* Existing `chat_dialogue_mv` must keep its MP3+lyrics-only input flow.
* The V6 LLM revision UX should stay consistent with existing V3 `/html-video/revise` behavior while being exposed as a chat panel on the V6 subpage.
* Preview revisions and final export should be visibly separate so real testers know when `final.mp4` needs regeneration.

### Failure / Edge Cases

* MP4 with no video stream, unreadable codec, remote URL, empty file, or path traversal must fail at upload/import time.
* MP4 audio may exist, but V6 final audio policy must ignore it in favor of the uploaded MP3.
* Conflicting active runs must reject input replacement and confirm actions consistently with V5.
* If timing dependencies are missing, the run should use the existing `timing_blocked` semantics rather than claiming success.
* If the html-video agent/runtime is missing, unauthenticated, times out, exits non-zero, changes forbidden paths, or fails frame validation, V6 must show a clear failure on the subpage and must not mark the run as successful.

## Technical Notes

* Relevant docs:
  * `docs/qivance_music_html_video_integration_prd.md`
  * `docs/qivance_music_html_video_integration_prd.v5.md`
  * `docs/SPEC.v5.md`
  * `docs/requirements traceability matrix.md`
* Relevant existing modules:
  * `src/lib/chain-registry/chain-registry.ts`
  * `src/lib/project-core/project-create-v5.ts`
  * `src/lib/project-core/project-inputs-v5.ts`
  * `src/lib/scheduler/server-runner-loop.ts`
  * `src/lib/scheduler/v5-task-handlers.ts`
  * `src/lib/video-html/source-video-import.ts`
  * `src/lib/export/render-manifest-v3.ts`
  * `src/lib/workbench/workbench-html.ts`
  * `src/server.ts`
* Relevant tests:
  * `tests/chain-registry-v5.test.ts`
  * `tests/project-inputs-v5.test.ts`
  * `tests/server-runner-loop-v5.test.ts`
  * `tests/timing-pipeline-v5.test.ts`
  * `tests/workbench-v5-api.test.ts`
  * `tests/source-video-import.test.ts`
  * `tests/workbench-api.test.ts`
