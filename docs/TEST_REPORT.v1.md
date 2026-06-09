# TEST_REPORT.v1

Date: 2026-06-06
Branch: `codex/html-video-rebuild`
Implementation commit: `2489748 Adopt html-video backend boundary`
Scope: first-phase Qivance Music backend rebuild around `vendor/html-video`.

## 1. Implemented PRD Requirements

### Fully implemented and covered by tests

- Added `vendor/html-video` as a git submodule and made the root project a pnpm workspace.
- Added direct backend imports for `@html-video/core`, `@html-video/content-graph`, and `@html-video/adapter-hyperframes`.
- Introduced `runHtmlVideoWorkflow(smallProjectId)` as the new runtime boundary.
- Enforced the project invariant `small_project_id === html-video project id`.
- Added project path helpers for `projects/<small_project_id>/...`.
- Added `AnimationPlan` validation for stable scene ids, non-empty scenes, contiguous order, positive durations, scene duration math, total duration drift, fps, resolution, and visual intensity.
- Added deterministic `AnimationPlan -> ContentGraph` mapping with scene ids as node ids, ordered sequence edges, and first-phase `intent = "explainer"`.
- Added html-video workspace writer for:
  - `project.json`
  - `content-graph.json`
  - `qivance-frame-contracts.json`
  - `codex/agent_context.json`
  - `frames/`, `codex/`, and `qa/` directories
- Added Codex frame prompt generation.
- Added Codex execution wrapper using `codex exec --json --sandbox workspace-write --skip-git-repo-check -`.
- Added Codex before/after file snapshot gate with `codex-forbidden-file-change`.
- Added strict render adapter wrapper with `duration-policy-violation`.
- Added preview model and server endpoints:
  - `GET /api/projects/:smallProjectId/video-html/preview`
  - `GET /preview/:smallProjectId/frames/:filename`
- Added sanitized frame basename serving and traversal rejection.
- Added ffprobe parsing and render manifest creation.
- Added mux wrapper for locked `audio/master/active_music_take.wav`.
- Added fixture demo input under `fixtures/html-video-demo`.
- Replaced old CLI/server workflow references with the html-video boundary.
- Removed old runtime modules for `post-minimax-workflow`, HypeFrames/Codex gates, WSL Codex runner, and old HyperFrames UI.
- Rewrote active tests around the new html-video boundary.

### Implemented as first-phase skeleton, not yet proven by real E2E

- Real Codex frame authoring path exists, but routine tests use an injected mock executor.
- Real html-video visual render path exists through the strict adapter, but it was not run with `QIVANCE_E2E_RENDER=1`.
- Real ffmpeg mux path exists, but it was not run against a rendered visual MP4 in local E2E.
- `render_manifest.json` records final stream QA from ffprobe, but visual MP4 probing is not yet represented as a separate manifest section.
- Frame contracts include timing-oriented fields, but `lyric_word_timing.json` is not yet parsed into `wordTimingRange`.

### Not implemented in this phase

- Big project/account model.
- Obsidian source import.
- RAG retrieval and asset recycling.
- DeepSeek lyrics generation.
- MiniMax music generation.
- Active music take selection UI.
- Qivance rap template pack.
- User-facing canvas editor beyond preview frame APIs.
- `resources.zip` packaging.
- Real local E2E automation behind `QIVANCE_E2E_CODEX=1` and `QIVANCE_E2E_RENDER=1`.
- Legacy fallback or `VIDEO_BACKEND=legacy`.

## 2. Tests Passed

Commands executed after implementation:

```text
pnpm typecheck
Result: passed
```

```text
pnpm test
Result: passed
Coverage: 17 html-video tests passed
```

```text
node --experimental-strip-types --test tests/*.test.ts
Result: passed
Coverage: 49 total tests passed
```

```text
pnpm -r build
Result: passed
Note: vendor/html-video studio-next emitted large chunk warnings only.
```

Previously executed during implementation:

```text
pnpm install
Result: passed
```

```text
npx gitnexus analyze
Result: passed
```

```text
npx gitnexus detect-changes --repo qivance-music
Result: completed with HIGH risk
Interpretation: expected for destructive runtime/server rebuild.
```

## 3. Tests Failed

No executed test command failed.

Not executed, therefore not proven:

- Real Codex CLI E2E.
- Real html-video/Hyperframes render E2E.
- Real ffmpeg mux plus final ffprobe QA on `exports/final.mp4`.
- Browser/canvas visual inspection.
- Multi-aspect template rendering across `9:16`, `16:9`, and `1:1`.

## 4. Requirements Proven Reasonable

- Deep vendor/submodule integration is practical. The root workspace can build html-video packages and direct imports work.
- Keeping Qivance timing metadata in `qivance-frame-contracts.json` is a good boundary. It avoids changing html-video public schema in phase one.
- The invariant `small_project_id === html-video project id` is simple and testable.
- CI should mock Codex execution. It keeps schema, workspace, preview, and manifest tests stable without requiring authenticated Codex.
- Strict duration as fail-fast is enforceable at the Qivance adapter boundary.
- Production preview can be built from html-video project files without restoring old `hypeframes/**` assumptions.
- Deleting old runtime modules is cleaner than maintaining a feature flag. Search and tests now prove runtime imports no longer depend on the removed path.

## 5. Assumptions Overturned Or Weakened

- Full timing bundle validation was too optimistic for this cut. `AnimationPlan` validation is solid, but `section_map`, `beat_grid`, and `lyric_word_timing` are currently referenced rather than deeply validated together.
- Word-level timing is not yet actually wired into frame contracts. The field exists, but no parser maps `lyric_word_timing.json` to `wordTimingRange`.
- Strict duration detection is narrower than the PRD wording. Current detection handles finite CSS animation declarations; it does not reliably inspect arbitrary GSAP timelines or runtime Web Animations.
- Visual and final ffprobe QA are not equally represented. The manifest currently focuses on final probe data; separate visual probe recording still needs implementation.
- Old workflow deletion did not remove all legacy vocabulary from the repository. Some remaining generic artifact/workflow tests still mention HypeFrames-era artifact ids, even though they no longer import deleted runtime modules.

## 6. Technical Debt Affecting Next Phases

- Timing contract layer is incomplete. Future subtitle highlight, beat sync, and music-aware animation need real parsers/validators for section map, beat grid, word timing, and energy curve.
- Render manifest schema is too small for production QA. It needs explicit visual probe, final probe, drift thresholds, ffmpeg command metadata, and failure diagnostics.
- Strict adapter duration detection needs a more reliable strategy for GSAP and JS-driven animation.
- `runHtmlVideoWorkflow` is currently a linear orchestration function. As retries, human review, and agent iteration arrive, it will need durable step state and resumability.
- Server preview API is intentionally minimal JSON/static frame serving. The user-facing canvas/editor is still absent.
- Old artifact catalog and workflow state modules still contain HypeFrames-era names. They do not block the new runtime, but they will confuse future UI/reporting work unless migrated.
- Demo fixture uses a generated sine WAV, not a realistic rap/music timing sample. It is enough for structure, not for visual/music QA.
- E2E render is gated by local Codex, browser/render tooling, and ffmpeg availability. CI will need explicit opt-in jobs or a separate local verification checklist.

## 7. Deferred Features That May Conflict With Current Implementation

- Big project/RAG integration may require project ids beyond the current flat `projects/<small_project_id>` layout. The path helper will need to absorb big-project namespace rules without breaking the html-video id invariant.
- Active music take selection UI must write the selected file exactly to `audio/master/active_music_take.wav`, or the current mux path will fail.
- Rich template packs may need shared assets. Current Codex prompt forbids network assets and only allows `frames/**/*.html`, `codex/**`, and `qa/**`, so template asset install paths need a controlled exception.
- User edit iteration will conflict with the current one-shot Codex runner unless turns, diffs, and approved frame revisions are modeled.
- Resource recycling/RAG asset capture will conflict with the current minimal manifest unless successful animation patterns and generated frame assets get explicit metadata.
- `resources.zip` packaging will need a stable artifact manifest. Current export only writes `visual.mp4`, `final.mp4`, and `render_manifest.json`.
- Multi-aspect output may conflict with fixed frame HTML if templates are not designed responsively. The contract validates resolution, but it does not enforce responsive frame layout.
- html-video Studio debug integration may conflict with production-only preview assumptions unless it remains clearly separated from user-facing routes.

## 8. Current Confidence

The backend boundary is structurally in place and covered by unit/integration tests with mocked Codex/render steps. The unproven part is real media production: authenticated Codex frame generation, real html-video render, ffmpeg mux, visual QA, and final MP4 inspection.
