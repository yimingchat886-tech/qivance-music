# Qivance html-video Rebuild Design

## Context

Qivance Music is being rebuilt around `nexu-io/html-video` as the video generation core. The existing project assets and old video runtime do not need to be preserved. This design follows:

- `/mnt/c/Users/Jym/Downloads/tele/qivance_music_html_video_integration_prd.md`
- `/mnt/c/Users/Jym/Downloads/tele/qivance_music_html_video_rebuild_codex_plan.md`
- the current discussion decision that the first implementation phase focuses on the canvas/video backend, while source import, RAG, lyrics generation, MiniMax music generation, and other upstream workflow pieces are split out for later phases.

The rebuild is intentionally not a compatibility migration. The old `hypeframes/**` runtime path, old post-MiniMax aggregate workflow, old HypeFrames/Codex gates, and old WSL Codex runner must not remain as runtime fallbacks.

## Assumptions

1. The repository can be reorganized destructively because no existing generated project assets need to survive.
2. First-stage fixture input starts after the upstream music planning boundary: `AnimationPlan`, `section_map.json`, `beat_grid.json`, `lyric_word_timing.json`, and `active_music_take.wav`.
3. `html-video` is integrated as `vendor/html-video` and imported directly from backend TypeScript, not treated as a long-term CLI black box.
4. `html-video project id` is exactly equal to `small_project_id`.
5. First-stage `durationPolicy` is only `strict`; if detected frame animation duration exceeds the contracted frame duration plus tolerance, rendering fails.
6. Strict duration is implemented in Qivance wrapper/adapter code, not by changing the public `@html-video/core` schema in the first phase.
7. Codex is part of the first-stage frame authoring path. There is no deterministic-only HTML fallback for the demo script.
8. CI tests may mock Codex execution, but the demo script must fail clearly when Codex CLI is unavailable.

## Success Criteria

1. Runtime code no longer imports the old video main workflow modules.
2. Backend code can directly import `@html-video/core`, `@html-video/content-graph`, and `@html-video/adapter-hyperframes`.
3. A fixture `AnimationPlan` maps deterministically to a valid html-video `ContentGraph`.
4. html-video workspace files are written under `projects/<small_project_id>/video/html-video/.html-video/projects/<small_project_id>/`.
5. `project.json`, `content-graph.json`, `qivance-frame-contracts.json`, and `codex/agent_context.json` are generated.
6. Codex frame agent generates or improves `frames/*.html`.
7. Codex file writes are checked and forbidden changes fail the workflow.
8. Strict duration violations fail with a structured `duration-policy-violation` error.
9. Render creates a visual-only MP4 through html-video and the Qivance strict Hyperframes adapter.
10. Export muxes the locked master audio into `exports/final.mp4`.
11. ffprobe QA confirms video stream, audio stream, duration drift, fps, and resolution.
12. Preview/canvas reads from html-video project frames, not from old `hypeframes/**`.
13. `render_manifest.json` records html-video backend, strict duration, master audio path, output paths, and QA results.

## Non-Goals

This phase does not implement:

- big-project UI and full account model;
- Obsidian source ingestion;
- RAG retrieval or asset recycling;
- DeepSeek lyrics generation;
- MiniMax music generation;
- active music take selection UI;
- Qivance rap template pack beyond minimal fixture needs;
- resources.zip packaging;
- old workflow compatibility flags;
- legacy HyperFrames preview fallback;
- static ffmpeg placeholder video as a fake successful html-video render.

## Architecture

The first-stage system is split into five backend areas:

```text
fixture/upstream artifacts
  -> video-contract validation
  -> video-html workspace and ContentGraph
  -> Codex frame agent
  -> strict html-video visual render
  -> Qivance locked-audio export
  -> preview/canvas model
```

The root project becomes a pnpm workspace so TypeScript can resolve html-video packages from `vendor/html-video/packages/*`. The initial code remains inside the current app instead of performing a full `apps/ + packages/` monorepo migration.

## Module Boundaries

`src/lib/project-core/` owns durable local project conventions:

- stable ids;
- project paths;
- small project manifest read/write;
- artifact metadata;
- workflow state names for the new html-video path.

`src/lib/video-contract/` owns Qivance truth schemas:

- `AnimationPlan`;
- timing contract validation;
- `AgentContext`;
- `QivanceFrameContracts`;
- strict duration policy types;
- combined validation for the input bundle.

This layer must not import Codex, html-video rendering, ffmpeg, or server routing.

`src/lib/video-html/` owns html-video integration:

- direct import smoke coverage;
- `AnimationPlan -> ContentGraph` deterministic mapper;
- html-video workspace creation;
- `qivance-frame-contracts.json`;
- Codex prompt building and execution;
- Codex write path gate;
- strict Hyperframes adapter wrapper;
- visual-only render;
- preview model derived from html-video project files.

`src/lib/canvas/` owns production preview endpoints and frame serving:

- `GET /api/projects/:smallProjectId/video-html/preview`;
- `GET /preview/:smallProjectId/frames/:filename`;
- path traversal protection;
- frame list model for the UI.

`src/lib/export/` owns final media delivery:

- ffprobe helpers;
- visual + locked audio mux;
- final QA;
- `render_manifest.json`.

## Vendor Integration

`vendor/html-video` is added as a git submodule. The root workspace includes:

```yaml
packages:
  - "."
  - "vendor/html-video/packages/*"
  - "vendor/html-video/templates/*"
```

The root package depends on:

```json
{
  "@html-video/core": "workspace:*",
  "@html-video/content-graph": "workspace:*",
  "@html-video/adapter-hyperframes": "workspace:*"
}
```

The first verification point is a smoke test that imports `ProjectStore`, `EngineRegistry`, `ProjectOrchestrator`, `validate`, `topoSort`, `totalDurationSec`, and the Hyperframes adapter package.

## Project Layout

Runtime project files are written under:

```text
projects/
  <small_project_id>/
    qivance/
      small_project_manifest.json
      animation_plan.json
      agent_context.json
    timing/
      section_map.json
      beat_grid.json
      lyric_word_timing.json
      energy_curve.json
    audio/
      master/
        active_music_take.wav
    video/
      html-video/
        .html-video/
          projects/
            <small_project_id>/
              project.json
              content-graph.json
              qivance-frame-contracts.json
              codex/
                agent_context.json
                prompt.md
                result.jsonl
                turns/
              frames/
              qa/
              output-visual.mp4
    exports/
      visual.mp4
      final.mp4
      render_manifest.json
```

The html-video project id and the Qivance small project id must remain identical in all generated files and manifests.

## Video Contract

`AnimationPlan` is the first-stage upstream source of truth for visual timing and scene intent. It contains title, category, target duration, fps, resolution, aspect ratio, mood, synopsis, and ordered scenes.

Validation rules:

- `scene.id` is stable and unique;
- `scene.order` is contiguous;
- `scene.durationSec` matches `endSec - startSec` within `0.05s`;
- scene duration sum matches `targetDurationSec` within `0.2s`;
- each scene is at least `1.0s`;
- scenes are non-empty;
- `endSec` is greater than `startSec`.

The timing contract validates that `section_map`, `beat_grid`, and `lyric_word_timing` are available and internally consistent enough to support frame contracts. Word timing is used only for captions, word highlight, and keyword pop effects in this phase.

## ContentGraph Mapping

`animationPlanToContentGraph(plan)` is deterministic.

Rules:

- scenes are sorted by `scene.order`;
- `node.id` equals `scene.id`;
- first phase uses `node.kind = "text"`;
- `node.text` is headline plus body lines;
- `node.frameIntent` is `scene.frameIntent`;
- `node.durationSec` is `scene.durationSec`;
- adjacent scenes become `sequence` edges;
- AI concept and English vocab map to `intent = "explainer"`;
- AI tool scenario also maps to `explainer` in the first phase.

The mapper must run html-video content graph validation, topological sorting, and total duration checks.

## Frame Contracts

`qivance-frame-contracts.json` is a Qivance sidecar beside `content-graph.json`. It keeps timing and music metadata out of the html-video public schema.

Each frame contract records:

- graph node id;
- scene id;
- order;
- start/end/duration;
- section id;
- strict duration flag;
- optional beat and word timing ranges;
- caption mode;
- visual intensity;
- allowed HTML output path.

Codex and render code treat this sidecar as authoritative for frame duration. Codex must not edit it.

## Codex Frame Agent

The first stage directly invokes Codex in non-interactive mode:

```text
codex exec --json --sandbox workspace-write --skip-git-repo-check -
```

The process cwd is the html-video project directory. The prompt is sent through stdin and persisted at `codex/prompt.md`. JSONL events are written to `codex/result.jsonl`.

Codex may write:

- `frames/**/*.html`;
- `codex/**`;
- `qa/**`.

Codex may not write:

- `project.json`;
- `content-graph.json`;
- `qivance-frame-contracts.json`;
- upstream `qivance/**`;
- timing files;
- audio files;
- paths outside the html-video project directory.

The path gate snapshots files before and after Codex execution. Forbidden changes fail the workflow with `codex-forbidden-file-change` and record the changed paths.

Each frame HTML includes `window.__QIVANCE_FRAME` with graph node id, scene id, duration, and `durationPolicy: "strict"`.

## Strict Duration Render

Qivance registers or overrides a Hyperframes engine with strict duration behavior. It reuses html-video adapter contracts but changes duration policy in the Qivance wrapper/adapter layer.

Render behavior:

1. Read requested duration from html-video frame render input.
2. Detect finite CSS/GSAP animation duration.
3. If detected duration is greater than requested duration plus tolerance, throw `StrictDurationViolationError`.
4. Never replace requested duration with detected duration.
5. Use requested duration for the actual render command.

First-stage policy is fail-fast, not trim and not auto-extend.

## Export

html-video renders the visual-only MP4. Qivance never trusts html-video as the final audio muxer.

Export flow:

1. Render visual-only MP4.
2. ffprobe visual output.
3. Read `audio/master/active_music_take.wav`.
4. Mux visual video stream with locked master audio.
5. ffprobe `exports/final.mp4`.
6. Write `exports/render_manifest.json`.

QA checks:

- final MP4 has video stream;
- final MP4 has audio stream;
- audio duration matches active music take within `0.3s`;
- video duration matches ContentGraph total duration within `0.3s`;
- final duration matches master audio duration within `0.5s`;
- fps and resolution match the AnimationPlan.

## Preview And Canvas

Production preview reads html-video project files:

- `project.json`;
- `content-graph.json`;
- `qivance-frame-contracts.json`;
- project frames.

Preview API:

```http
GET /api/projects/:smallProjectId/video-html/preview
```

The response includes small project id, html-video project id, total duration, and ordered frame preview entries. Frame URLs are served through:

```http
GET /preview/:smallProjectId/frames/:filename
```

The static route sanitizes `filename`, rejects path traversal, and only serves `frames/*.html` for the requested project. It does not serve arbitrary project files.

## Demo Boundary

`scripts/demo-html-video-from-fixture.ts` is the first end-to-end entry.

Input:

```text
fixtures/html-video-demo/animation_plan.json
fixtures/html-video-demo/section_map.json
fixtures/html-video-demo/beat_grid.json
fixtures/html-video-demo/lyric_word_timing.json
fixtures/html-video-demo/active_music_take.wav
```

Output:

```text
projects/demo_html_video_001/video/html-video/.html-video/projects/demo_html_video_001/content-graph.json
projects/demo_html_video_001/video/html-video/.html-video/projects/demo_html_video_001/frames/*.html
projects/demo_html_video_001/exports/visual.mp4
projects/demo_html_video_001/exports/final.mp4
projects/demo_html_video_001/exports/render_manifest.json
```

The demo must call real Codex. If Codex is unavailable, it fails with an explicit installation/authentication message. CI integration tests may use a mock executor to validate all surrounding logic.

## Legacy Removal

The new runtime must not import:

- `src/lib/post-minimax-workflow.ts`;
- `src/lib/hypeframes-agent-prompt.ts`;
- `src/lib/hypeframes-codex-agent.ts`;
- `src/lib/wsl-codex-runner.ts`;
- `src/lib/hyperframes-ui.ts`;
- old HypeFrames file gates;
- old Codex gates.

If source is kept temporarily for reference, it must live under `docs/legacy-snapshot/` and must not be imported by runtime or tests.

The implementation must not introduce:

- `VIDEO_BACKEND=legacy`;
- legacy HypeFrames fallback;
- old `hypeframes/**` preview fallback;
- static ffmpeg placeholder video as a fake successful render.

## Testing Strategy

Unit tests cover:

- project paths;
- AnimationPlan validation;
- timing/frame contract validation;
- `AnimationPlan -> ContentGraph`;
- deterministic mapper output;
- Codex prompt builder;
- path gate;
- ffprobe parsing.

Adapter tests cover:

- animation duration within frame duration succeeds;
- animation duration beyond strict tolerance fails;
- render metadata uses requested duration.

Integration tests cover:

- CI default with mock Codex executor for schema, workspace, path gate, preview model, and render manifest logic;
- local E2E behind `QIVANCE_E2E_CODEX=1` and `QIVANCE_E2E_RENDER=1` for real Codex, Chromium/Hyperframes, ffmpeg, and final MP4 output.

## Risks

The highest risk is version mismatch between the current html-video package types and the plan's expected `Project` shape. The implementation should follow vendor types while preserving the invariant that `project.id === small_project_id`.

Strict duration detection may depend on html-video adapter internals. The wrapper should be small and well tested, and it should fail clearly when a duration cannot be determined.

Codex frame authoring introduces environmental instability. The demo should fail explicitly when Codex is missing, while CI should mock Codex execution to keep routine verification stable.

Full deletion of old workflow code will break existing tests by design. The test suite should be rewritten around the new html-video boundary rather than preserving old HypeFrames assertions.
