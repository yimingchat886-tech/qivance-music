# V2 Media E2E Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the V2 media E2E workflow that turns three locked media fixture bundles into verified `final.mp4` outputs with machine-readable manifests.

**Architecture:** Add a workflow-centered media E2E layer that composes focused modules for fixture validation, audio analysis, word alignment, section mapping, image generation, html-video integration, render/mux, and manifest/report evidence. Existing html-video project/render boundaries stay authoritative for frame authoring and strict duration behavior; Qivance validates inputs/outputs and records evidence.

**Tech Stack:** TypeScript, Node test runner, Python/librosa, WhisperX, html-video packages, ffmpeg/ffprobe, Codex image_gen adapter, pnpm workspace.

---

## 0. Implementation Rules

- Before editing existing symbols, run `npx gitnexus impact --repo qivance-music <symbol>` or the closest available GitNexus CLI impact command and record risk in the task notes.
- After major structural edits, run `npx gitnexus analyze`.
- Before any commit, run `npx gitnexus detect-changes --repo qivance-music`.
- Do not restore the old Qivance Codex runner as the V2 frame authoring runtime.
- Do not implement DeepSeek, MiniMax, RAG, full workbench UI, Preview revise, or a task queue.
- Keep every generated fixture/media artifact out of source unless intentionally committed as a small test fixture.

---

## 1. File Structure

### Create

- `src/lib/media-e2e/types.ts` - workflow option, step, checkpoint, and result types.
- `src/lib/media-e2e/fixture-contract.ts` - validates the three fixture bundles.
- `src/lib/media-e2e/checkpoints.ts` - writes and reads per-step checkpoint state.
- `src/lib/media-e2e/workflow.ts` - orchestrates the V2 workflow.
- `src/lib/media-e2e/test-report.ts` - appends `TEST_REPORT.v2.md` evidence.
- `src/lib/audio-analysis/types.ts` - beat/onset/energy artifact types.
- `src/lib/audio-analysis/librosa-runner.ts` - invokes Python/librosa and validates outputs.
- `scripts/python/analyze-audio-librosa.py` - real librosa analysis script.
- `src/lib/word-alignment/types.ts` - word timing, report, override, and metrics types.
- `src/lib/word-alignment/lyrics-normalizer.ts` - normalizes `lyrics.md` while preserving source words.
- `src/lib/word-alignment/whisperx-runner.ts` - invokes WhisperX and maps evidence to lyrics words.
- `src/lib/word-alignment/quality-gate.ts` - enforces V2 word timing gates.
- `src/lib/word-alignment/alignment-override.ts` - validates and applies timing-only overrides.
- `src/lib/section-map/section-map-builder.ts` - builds `section_map.json`.
- `src/lib/image-generation/types.ts` - adapter, request, result, candidate, asset types.
- `src/lib/image-generation/codex-image-gen-adapter.ts` - V2 primary image generation adapter.
- `src/lib/image-generation/image-assets.ts` - lock/reject/skip gate and `image_assets.json`.
- `src/lib/video-html/html-video-agent-runtime.ts` - bridge to html-video agent/runtime.
- `src/lib/video-html/frame-output-validator.ts` - validates frames and local image refs.
- `src/lib/export/render-manifest-v2.ts` - V2 manifest writer and validator.
- `scripts/e2e-media-v2.ts` - local full E2E script.
- `tests/media-e2e-fixture-contract.test.ts`
- `tests/media-e2e-checkpoints.test.ts`
- `tests/audio-analysis-artifacts.test.ts`
- `tests/word-alignment-normalizer.test.ts`
- `tests/word-alignment-quality-gate.test.ts`
- `tests/alignment-override.test.ts`
- `tests/section-map-builder.test.ts`
- `tests/image-generation-assets.test.ts`
- `tests/html-video-frame-output-validator.test.ts`
- `tests/render-manifest-v2.test.ts`
- `tests/media-e2e-workflow.test.ts`
- `tests/mux-locked-audio-mp3.test.ts`

### Modify

- `src/lib/project-core/paths.ts` - add V2 media E2E path helpers if existing helpers are insufficient.
- `src/lib/video-html/html-video-workspace.ts` - include V2 timing/image context inputs if current writer is too narrow.
- `src/lib/video-html/qivance-frame-contracts.ts` - include word timing ranges, beat ranges, and allowed image asset ids.
- `src/lib/export/ffprobe.ts` - expose codec and stream count fields needed by V2 QA.
- `src/lib/export/mux-locked-audio.ts` - support `active_music_take.mp3` input and AAC output.
- `package.json` - add scripts for V2 E2E and Python dependency notes only if needed.

---

## Task 1: Fixture Contract And Paths

**Files:**
- Create: `src/lib/media-e2e/types.ts`
- Create: `src/lib/media-e2e/fixture-contract.ts`
- Modify: `src/lib/project-core/paths.ts`
- Test: `tests/media-e2e-fixture-contract.test.ts`

- [ ] **Step 1: Write fixture contract tests**

Create `tests/media-e2e-fixture-contract.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { validateMediaE2EFixtureBundle } from "../src/lib/media-e2e/fixture-contract.ts";

test("validates required V2 fixture files and ratio", async () => {
  const root = join(process.cwd(), "tmp-fixture-contract-valid");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "active_music_take.mp3"), "fake-mp3");
  await writeFile(join(root, "lyrics.md"), "RAG is not magic");
  await writeFile(join(root, "animation_plan.json"), JSON.stringify({
    schema_version: 1,
    small_project_id: "media_e2e_v2_portrait_9x16",
    aspect_ratio: "9:16",
    resolution: { width: 1080, height: 1920 },
    fps: 30,
    duration_sec: 30,
    scenes: [
      { scene_id: "scene_001_hook", section_ids: ["sec_001_hook"], start_sec: 0, end_sec: 8, image_generation: { enabled: true } },
      { scene_id: "scene_002_body", section_ids: ["sec_002_body"], start_sec: 8, end_sec: 22, image_generation: { enabled: false } },
      { scene_id: "scene_003_outro", section_ids: ["sec_003_outro"], start_sec: 22, end_sec: 30, image_generation: { enabled: false } }
    ]
  }));
  await writeFile(join(root, "image_generation_plan.json"), JSON.stringify({
    schema_version: 1,
    small_project_id: "media_e2e_v2_portrait_9x16",
    requests: [{ request_id: "img_req_scene_001", scene_id: "scene_001_hook", asset_role: "background", prompt: "no text", reference_asset_ids: [], aspect_ratio: "9:16", target_size: { width: 1080, height: 1920 }, variants: 2 }]
  }));

  const result = await validateMediaE2EFixtureBundle({ bundlePath: root, ratio: "portrait-9x16" });

  assert.equal(result.ok, true);
  assert.equal(result.projectId, "media_e2e_v2_portrait_9x16");
});

test("rejects fixtures without a generated background scene", async () => {
  const root = join(process.cwd(), "tmp-fixture-contract-invalid");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "active_music_take.mp3"), "fake-mp3");
  await writeFile(join(root, "lyrics.md"), "RAG is not magic");
  await writeFile(join(root, "animation_plan.json"), JSON.stringify({
    schema_version: 1,
    small_project_id: "media_e2e_v2_square_1x1",
    aspect_ratio: "1:1",
    resolution: { width: 1080, height: 1080 },
    fps: 30,
    duration_sec: 30,
    scenes: [
      { scene_id: "scene_001_hook", section_ids: ["sec_001_hook"], start_sec: 0, end_sec: 10, image_generation: { enabled: false } },
      { scene_id: "scene_002_body", section_ids: ["sec_002_body"], start_sec: 10, end_sec: 20, image_generation: { enabled: false } },
      { scene_id: "scene_003_outro", section_ids: ["sec_003_outro"], start_sec: 20, end_sec: 30, image_generation: { enabled: false } }
    ]
  }));
  await writeFile(join(root, "image_generation_plan.json"), JSON.stringify({ schema_version: 1, requests: [] }));

  const result = await validateMediaE2EFixtureBundle({ bundlePath: root, ratio: "square-1x1" });

  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /image_generation.enabled/);
});
```

- [ ] **Step 2: Run the failing fixture tests**

Run: `node --experimental-strip-types --test tests/media-e2e-fixture-contract.test.ts`

Expected: FAIL because `src/lib/media-e2e/fixture-contract.ts` does not exist.

- [ ] **Step 3: Implement minimal fixture types and validator**

Create `src/lib/media-e2e/types.ts`:

```ts
export type MediaE2ERatio = "portrait-9x16" | "landscape-16x9" | "square-1x1";

export type MediaE2EWorkflowOptions = {
  forceAll?: boolean;
  forceStep?: string[];
  skipPreviewSmoke?: boolean;
  requireGpu?: boolean;
  fixtureRatio?: MediaE2ERatio;
  reportPath?: string;
};

export type MediaE2EValidationResult = {
  ok: boolean;
  projectId: string | null;
  issues: string[];
};

export const MEDIA_E2E_RATIO_CONFIG: Record<MediaE2ERatio, { aspectRatio: string; width: number; height: number }> = {
  "portrait-9x16": { aspectRatio: "9:16", width: 1080, height: 1920 },
  "landscape-16x9": { aspectRatio: "16:9", width: 1920, height: 1080 },
  "square-1x1": { aspectRatio: "1:1", width: 1080, height: 1080 },
};
```

Create `src/lib/media-e2e/fixture-contract.ts`:

```ts
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { MEDIA_E2E_RATIO_CONFIG, type MediaE2ERatio, type MediaE2EValidationResult } from "./types.ts";

export async function validateMediaE2EFixtureBundle(input: {
  bundlePath: string;
  ratio: MediaE2ERatio;
}): Promise<MediaE2EValidationResult> {
  const issues: string[] = [];
  for (const file of ["active_music_take.mp3", "lyrics.md", "animation_plan.json", "image_generation_plan.json"]) {
    try {
      await access(join(input.bundlePath, file));
    } catch {
      issues.push(`missing required fixture file: ${file}`);
    }
  }

  const plan = await readJson(join(input.bundlePath, "animation_plan.json"), issues);
  const imagePlan = await readJson(join(input.bundlePath, "image_generation_plan.json"), issues);
  const config = MEDIA_E2E_RATIO_CONFIG[input.ratio];
  const projectId = stringValue(plan?.small_project_id);

  if (plan) {
    if (plan.aspect_ratio !== config.aspectRatio) issues.push(`animation_plan.aspect_ratio must be ${config.aspectRatio}`);
    if (plan.resolution?.width !== config.width || plan.resolution?.height !== config.height) {
      issues.push(`animation_plan.resolution must be ${config.width}x${config.height}`);
    }
    const scenes = Array.isArray(plan.scenes) ? plan.scenes : [];
    if (scenes.length < 3) issues.push("animation_plan.scenes must contain at least 3 scenes");
    if (!scenes.some((scene: any) => scene?.image_generation?.enabled === true)) {
      issues.push("at least one scene must set image_generation.enabled = true");
    }
  }

  if (imagePlan) {
    const requests = Array.isArray(imagePlan.requests) ? imagePlan.requests : [];
    if (requests.length < 1) issues.push("image_generation_plan.requests must contain at least one request");
  }

  return { ok: issues.length === 0, projectId, issues };
}

async function readJson(path: string, issues: string[]): Promise<any | null> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    issues.push(`invalid json: ${path}`);
    return null;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
```

- [ ] **Step 4: Run fixture tests**

Run: `node --experimental-strip-types --test tests/media-e2e-fixture-contract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib/media-e2e/types.ts src/lib/media-e2e/fixture-contract.ts tests/media-e2e-fixture-contract.test.ts
git commit -m "Add media E2E fixture validation"
```

---

## Task 2: Checkpoints And Workflow Skeleton

**Files:**
- Create: `src/lib/media-e2e/checkpoints.ts`
- Create: `src/lib/media-e2e/workflow.ts`
- Test: `tests/media-e2e-checkpoints.test.ts`
- Test: `tests/media-e2e-workflow.test.ts`

- [ ] **Step 1: Write checkpoint tests**

Create `tests/media-e2e-checkpoints.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { readStepCheckpoint, writeStepCheckpoint } from "../src/lib/media-e2e/checkpoints.ts";

test("writes and reads a completed workflow checkpoint", async () => {
  const projectRoot = join(process.cwd(), "tmp-media-e2e-checkpoints");
  await mkdir(projectRoot, { recursive: true });

  await writeStepCheckpoint(projectRoot, {
    step: "validate_fixture_bundle",
    status: "passed",
    inputs: ["animation_plan.json"],
    outputs: ["checkpoint.json"],
    diagnostics: []
  });

  const checkpoint = await readStepCheckpoint(projectRoot, "validate_fixture_bundle");

  assert.equal(checkpoint?.status, "passed");
  assert.equal(checkpoint?.step, "validate_fixture_bundle");
});
```

- [ ] **Step 2: Write workflow order test**

Create `tests/media-e2e-workflow.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { MEDIA_E2E_WORKFLOW_STEPS } from "../src/lib/media-e2e/workflow.ts";

test("V2 workflow order matches the SPEC", () => {
  assert.deepEqual(MEDIA_E2E_WORKFLOW_STEPS, [
    "validate_fixture_bundle",
    "analyze_audio_with_librosa",
    "align_words_with_whisperx",
    "build_section_map",
    "generate_background_images",
    "review_and_lock_image_assets",
    "write_html_video_workspace",
    "run_html_video_agent_runtime",
    "validate_frame_outputs",
    "static_preview_smoke",
    "render_visual_with_html_video",
    "mux_active_mp3_to_final_aac",
    "ffprobe_visual_and_final",
    "write_render_manifest",
    "append_test_report_evidence"
  ]);
});
```

- [ ] **Step 3: Run failing workflow tests**

Run: `node --experimental-strip-types --test tests/media-e2e-checkpoints.test.ts tests/media-e2e-workflow.test.ts`

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement checkpoints and workflow constants**

Create `src/lib/media-e2e/checkpoints.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type MediaE2EStepStatus = "passed" | "failed";

export type MediaE2EStepCheckpoint = {
  step: string;
  status: MediaE2EStepStatus;
  inputs: string[];
  outputs: string[];
  diagnostics: string[];
  startedAt: string;
  completedAt: string;
};

export async function writeStepCheckpoint(
  projectRoot: string,
  checkpoint: Omit<MediaE2EStepCheckpoint, "startedAt" | "completedAt"> & Partial<Pick<MediaE2EStepCheckpoint, "startedAt" | "completedAt">>,
): Promise<void> {
  const dir = join(projectRoot, "logs", "media-e2e", "checkpoints");
  await mkdir(dir, { recursive: true });
  const now = new Date().toISOString();
  await writeFile(join(dir, `${checkpoint.step}.json`), JSON.stringify({
    ...checkpoint,
    startedAt: checkpoint.startedAt ?? now,
    completedAt: checkpoint.completedAt ?? now,
  }, null, 2));
}

export async function readStepCheckpoint(projectRoot: string, step: string): Promise<MediaE2EStepCheckpoint | null> {
  try {
    return JSON.parse(await readFile(join(projectRoot, "logs", "media-e2e", "checkpoints", `${step}.json`), "utf8"));
  } catch {
    return null;
  }
}
```

Create `src/lib/media-e2e/workflow.ts`:

```ts
export const MEDIA_E2E_WORKFLOW_STEPS = [
  "validate_fixture_bundle",
  "analyze_audio_with_librosa",
  "align_words_with_whisperx",
  "build_section_map",
  "generate_background_images",
  "review_and_lock_image_assets",
  "write_html_video_workspace",
  "run_html_video_agent_runtime",
  "validate_frame_outputs",
  "static_preview_smoke",
  "render_visual_with_html_video",
  "mux_active_mp3_to_final_aac",
  "ffprobe_visual_and_final",
  "write_render_manifest",
  "append_test_report_evidence",
] as const;

export type MediaE2EWorkflowStep = typeof MEDIA_E2E_WORKFLOW_STEPS[number];

export async function runMediaE2EWorkflow(): Promise<void> {
  throw new Error("runMediaE2EWorkflow is implemented task-by-task in PLAN.v2");
}
```

- [ ] **Step 5: Run workflow tests**

Run: `node --experimental-strip-types --test tests/media-e2e-checkpoints.test.ts tests/media-e2e-workflow.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/lib/media-e2e/checkpoints.ts src/lib/media-e2e/workflow.ts tests/media-e2e-checkpoints.test.ts tests/media-e2e-workflow.test.ts
git commit -m "Add media E2E workflow checkpoints"
```

---

## Task 3: Audio Analysis Artifacts

**Files:**
- Create: `src/lib/audio-analysis/types.ts`
- Create: `src/lib/audio-analysis/librosa-runner.ts`
- Create: `scripts/python/analyze-audio-librosa.py`
- Test: `tests/audio-analysis-artifacts.test.ts`

- [ ] **Step 1: Write artifact validation tests**

Create `tests/audio-analysis-artifacts.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAudioAnalysisArtifacts } from "../src/lib/audio-analysis/librosa-runner.ts";

test("accepts beat, onset, and energy artifacts matching duration", () => {
  const result = validateAudioAnalysisArtifacts({
    expectedDurationSec: 30,
    beatGrid: { schema_version: 1, duration_sec: 30.02, tempo_bpm: 92, tempo_candidates: [92], beats: [{ index: 0, time_sec: 0.5, confidence: 0.8 }] },
    onsetEvents: { schema_version: 1, duration_sec: 30.01, events: [{ time_sec: 0.51, strength: 0.9 }] },
    energyCurve: { schema_version: 1, duration_sec: 30, frame_hop_sec: 0.1, points: [{ time_sec: 0, rms: 0.1, normalized_energy: 0.5 }], low_energy_ranges: [] }
  });

  assert.equal(result.ok, true);
});

test("rejects out-of-range timing evidence", () => {
  const result = validateAudioAnalysisArtifacts({
    expectedDurationSec: 30,
    beatGrid: { schema_version: 1, duration_sec: 30, tempo_bpm: 92, tempo_candidates: [92], beats: [{ index: 0, time_sec: 31, confidence: 0.8 }] },
    onsetEvents: { schema_version: 1, duration_sec: 30, events: [] },
    energyCurve: { schema_version: 1, duration_sec: 30, frame_hop_sec: 0.1, points: [], low_energy_ranges: [] }
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /out of range/);
});
```

- [ ] **Step 2: Run failing artifact tests**

Run: `node --experimental-strip-types --test tests/audio-analysis-artifacts.test.ts`

Expected: FAIL because audio-analysis module does not exist.

- [ ] **Step 3: Implement artifact types and validator**

Create `src/lib/audio-analysis/types.ts`:

```ts
export type BeatGrid = {
  schema_version: 1;
  duration_sec: number;
  tempo_bpm: number;
  tempo_candidates: number[];
  beats: Array<{ index: number; time_sec: number; confidence: number }>;
};

export type OnsetEvents = {
  schema_version: 1;
  duration_sec: number;
  events: Array<{ time_sec: number; strength: number }>;
};

export type EnergyCurve = {
  schema_version: 1;
  duration_sec: number;
  frame_hop_sec: number;
  points: Array<{ time_sec: number; rms: number; normalized_energy: number }>;
  low_energy_ranges: Array<{ start_sec: number; end_sec: number }>;
};
```

Create `src/lib/audio-analysis/librosa-runner.ts`:

```ts
import type { BeatGrid, EnergyCurve, OnsetEvents } from "./types.ts";

export function validateAudioAnalysisArtifacts(input: {
  expectedDurationSec: number;
  beatGrid: BeatGrid;
  onsetEvents: OnsetEvents;
  energyCurve: EnergyCurve;
}): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  for (const [name, duration] of [
    ["beat_grid", input.beatGrid.duration_sec],
    ["onset_events", input.onsetEvents.duration_sec],
    ["energy_curve", input.energyCurve.duration_sec],
  ] as const) {
    if (Math.abs(duration - input.expectedDurationSec) > 0.15) issues.push(`${name} duration differs from mp3 duration by more than 150ms`);
  }
  for (const beat of input.beatGrid.beats) {
    if (beat.time_sec < 0 || beat.time_sec > input.expectedDurationSec) issues.push(`beat ${beat.index} out of range`);
  }
  for (const event of input.onsetEvents.events) {
    if (event.time_sec < 0 || event.time_sec > input.expectedDurationSec) issues.push(`onset ${event.time_sec} out of range`);
  }
  for (const point of input.energyCurve.points) {
    if (point.time_sec < 0 || point.time_sec > input.expectedDurationSec) issues.push(`energy point ${point.time_sec} out of range`);
  }
  return { ok: issues.length === 0, issues };
}
```

- [ ] **Step 4: Add Python librosa script skeleton**

Create `scripts/python/analyze-audio-librosa.py`:

```python
#!/usr/bin/env python3
import json
import sys
from pathlib import Path

import librosa


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: analyze-audio-librosa.py <input.mp3> <output-dir>", file=sys.stderr)
        return 2
    audio_path = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    output_dir.mkdir(parents=True, exist_ok=True)
    y, sr = librosa.load(audio_path, sr=None, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beats, sr=sr)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    onset_frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr)
    onset_times = librosa.frames_to_time(onset_frames, sr=sr)
    rms = librosa.feature.rms(y=y)[0]
    rms_times = librosa.frames_to_time(range(len(rms)), sr=sr)
    peak = max(float(v) for v in rms) if len(rms) else 1.0

    (output_dir / "beat_grid.json").write_text(json.dumps({
        "schema_version": 1,
        "duration_sec": round(duration, 3),
        "tempo_bpm": round(float(tempo), 3),
        "tempo_candidates": [round(float(tempo), 3)],
        "beats": [{"index": i, "time_sec": round(float(t), 3), "confidence": 1.0} for i, t in enumerate(beat_times)]
    }, indent=2))
    (output_dir / "onset_events.json").write_text(json.dumps({
        "schema_version": 1,
        "duration_sec": round(duration, 3),
        "events": [{"time_sec": round(float(t), 3), "strength": 1.0} for t in onset_times]
    }, indent=2))
    (output_dir / "energy_curve.json").write_text(json.dumps({
        "schema_version": 1,
        "duration_sec": round(duration, 3),
        "frame_hop_sec": 0.1,
        "points": [{"time_sec": round(float(t), 3), "rms": round(float(v), 6), "normalized_energy": round(float(v) / peak, 6)} for t, v in zip(rms_times, rms)],
        "low_energy_ranges": []
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: Run artifact tests**

Run: `node --experimental-strip-types --test tests/audio-analysis-artifacts.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/lib/audio-analysis scripts/python/analyze-audio-librosa.py tests/audio-analysis-artifacts.test.ts
git commit -m "Add librosa audio analysis artifacts"
```

---

## Task 4: Word Alignment Quality Gate

**Files:**
- Create: `src/lib/word-alignment/types.ts`
- Create: `src/lib/word-alignment/lyrics-normalizer.ts`
- Create: `src/lib/word-alignment/quality-gate.ts`
- Create: `src/lib/word-alignment/alignment-override.ts`
- Test: `tests/word-alignment-normalizer.test.ts`
- Test: `tests/word-alignment-quality-gate.test.ts`
- Test: `tests/alignment-override.test.ts`

- [ ] **Step 1: Write word alignment tests**

Create `tests/word-alignment-quality-gate.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateWordAlignmentQuality } from "../src/lib/word-alignment/quality-gate.ts";

test("passes medium strict production gate", () => {
  const result = evaluateWordAlignmentQuality({
    totalWords: 100,
    alignedWords: 90,
    lowConfidenceWords: 10,
    unmatchedWords: 5,
    sectionDurationCoverage: 0.99,
    sectionBoundaryEvidenceDriftSec: 0.32
  });

  assert.equal(result.ok, true);
});

test("fails when word coverage is below 85 percent", () => {
  const result = evaluateWordAlignmentQuality({
    totalWords: 100,
    alignedWords: 84,
    lowConfidenceWords: 10,
    unmatchedWords: 5,
    sectionDurationCoverage: 0.99,
    sectionBoundaryEvidenceDriftSec: 0.32
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /word coverage/);
});
```

Create `tests/word-alignment-normalizer.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeLyricsMarkdown } from "../src/lib/word-alignment/lyrics-normalizer.ts";

test("normalizes lyrics while preserving source words and order", () => {
  const normalized = normalizeLyricsMarkdown("## Hook\nRAG isn't magic.\n\n## Outro\nRAG returns facts!");

  assert.deepEqual(normalized.words.map((word) => word.text), ["RAG", "isn't", "magic", "RAG", "returns", "facts"]);
  assert.equal(normalized.words[0].paragraphId, "p_001");
  assert.equal(normalized.words[3].paragraphId, "p_002");
});
```

Create `tests/alignment-override.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAlignmentOverride } from "../src/lib/word-alignment/alignment-override.ts";

test("allows timing-only overrides for specific word ranges", () => {
  const result = validateAlignmentOverride({
    schema_version: 1,
    override_author: "tester",
    reason: "low confidence around repeated chorus",
    created_at: "2026-06-09T00:00:00.000Z",
    changed_ranges: [{ range_id: "override_001", word_ids: ["w_000001"], new_start_sec: 1, new_end_sec: 1.5 }]
  });

  assert.equal(result.ok, true);
});
```

- [ ] **Step 2: Run failing word alignment tests**

Run: `node --experimental-strip-types --test tests/word-alignment-normalizer.test.ts tests/word-alignment-quality-gate.test.ts tests/alignment-override.test.ts`

Expected: FAIL because word-alignment modules do not exist.

- [ ] **Step 3: Implement word alignment types and quality gate**

Create `src/lib/word-alignment/types.ts`:

```ts
export type LyricsWord = {
  wordId: string;
  paragraphId: string;
  lineId: string;
  text: string;
  normalizedText: string;
};

export type WordAlignmentMetrics = {
  totalWords: number;
  alignedWords: number;
  lowConfidenceWords: number;
  unmatchedWords: number;
  sectionDurationCoverage: number;
  sectionBoundaryEvidenceDriftSec: number;
};
```

Create `src/lib/word-alignment/quality-gate.ts`:

```ts
import type { WordAlignmentMetrics } from "./types.ts";

export function evaluateWordAlignmentQuality(metrics: WordAlignmentMetrics): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const wordCoverage = metrics.totalWords === 0 ? 0 : metrics.alignedWords / metrics.totalWords;
  const lowConfidenceRatio = metrics.totalWords === 0 ? 1 : metrics.lowConfidenceWords / metrics.totalWords;
  const unmatchedRatio = metrics.totalWords === 0 ? 1 : metrics.unmatchedWords / metrics.totalWords;
  if (wordCoverage < 0.85) issues.push("word coverage must be >= 85%");
  if (lowConfidenceRatio > 0.15) issues.push("low confidence words must be <= 15%");
  if (unmatchedRatio > 0.10) issues.push("unmatched words must be <= 10%");
  if (metrics.sectionDurationCoverage < 0.98) issues.push("section duration coverage must be >= 98%");
  if (metrics.sectionBoundaryEvidenceDriftSec > 0.5) issues.push("section boundary evidence drift must be <= 0.5s");
  return { ok: issues.length === 0, issues };
}
```

- [ ] **Step 4: Implement lyrics normalizer and override validator**

Create `src/lib/word-alignment/lyrics-normalizer.ts`:

```ts
import type { LyricsWord } from "./types.ts";

export function normalizeLyricsMarkdown(markdown: string): { words: LyricsWord[] } {
  const paragraphs = markdown
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.replace(/^#+\s*/gm, "").trim())
    .filter(Boolean);
  const words: LyricsWord[] = [];
  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraphId = `p_${String(paragraphIndex + 1).padStart(3, "0")}`;
    const lines = paragraphs[paragraphIndex]!.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const lineId = `line_${String(words.length + 1).padStart(3, "0")}`;
      for (const raw of lines[lineIndex]!.split(/\s+/)) {
        const text = raw.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
        if (!text) continue;
        words.push({
          wordId: `w_${String(words.length + 1).padStart(6, "0")}`,
          paragraphId,
          lineId,
          text,
          normalizedText: text.toLowerCase(),
        });
      }
    }
  }
  return { words };
}
```

Create `src/lib/word-alignment/alignment-override.ts`:

```ts
export function validateAlignmentOverride(value: any): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (value?.schema_version !== 1) issues.push("alignment_override.schema_version must be 1");
  if (typeof value?.override_author !== "string" || value.override_author.length === 0) issues.push("override_author is required");
  if (typeof value?.reason !== "string" || value.reason.length === 0) issues.push("reason is required");
  if (!Array.isArray(value?.changed_ranges) || value.changed_ranges.length === 0) issues.push("changed_ranges must be non-empty");
  for (const range of value?.changed_ranges ?? []) {
    if (!Array.isArray(range.word_ids) || range.word_ids.length === 0) issues.push("changed range word_ids must be non-empty");
    if (typeof range.new_start_sec !== "number" || typeof range.new_end_sec !== "number") issues.push("changed range must provide timing only");
    if (range.text !== undefined || range.normalized_text !== undefined) issues.push("override must not modify lyric text");
  }
  return { ok: issues.length === 0, issues };
}
```

- [ ] **Step 5: Run word alignment tests**

Run: `node --experimental-strip-types --test tests/word-alignment-normalizer.test.ts tests/word-alignment-quality-gate.test.ts tests/alignment-override.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/lib/word-alignment tests/word-alignment-normalizer.test.ts tests/word-alignment-quality-gate.test.ts tests/alignment-override.test.ts
git commit -m "Add word alignment quality gates"
```

---

## Task 5: Section Map Builder

**Files:**
- Create: `src/lib/section-map/section-map-builder.ts`
- Test: `tests/section-map-builder.test.ts`

- [ ] **Step 1: Write section map tests**

Create `tests/section-map-builder.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSectionMapFromEvidence } from "../src/lib/section-map/section-map-builder.ts";

test("builds section map from scenes and timing evidence", () => {
  const map = buildSectionMapFromEvidence({
    durationSec: 30,
    scenes: [
      { scene_id: "scene_001_hook", section_ids: ["sec_001_hook"], start_sec: 0, end_sec: 8 },
      { scene_id: "scene_002_body", section_ids: ["sec_002_body"], start_sec: 8, end_sec: 22 },
      { scene_id: "scene_003_outro", section_ids: ["sec_003_outro"], start_sec: 22, end_sec: 30 }
    ],
    words: [
      { word_id: "w_000001", paragraph_id: "p_001", start_sec: 0.5, end_sec: 1.0 },
      { word_id: "w_000002", paragraph_id: "p_002", start_sec: 10, end_sec: 10.5 },
      { word_id: "w_000003", paragraph_id: "p_003", start_sec: 24, end_sec: 24.5 }
    ],
    beats: [{ index: 0, time_sec: 0 }, { index: 1, time_sec: 8 }, { index: 2, time_sec: 22 }]
  });

  assert.equal(map.sections.length, 3);
  assert.equal(map.sections[0]?.section_id, "sec_001_hook");
  assert.equal(map.sections[0]?.word_range.start_word_id, "w_000001");
});
```

- [ ] **Step 2: Run failing section map test**

Run: `node --experimental-strip-types --test tests/section-map-builder.test.ts`

Expected: FAIL because section-map module does not exist.

- [ ] **Step 3: Implement minimal section map builder**

Create `src/lib/section-map/section-map-builder.ts`:

```ts
type SceneInput = { scene_id: string; section_ids: string[]; start_sec: number; end_sec: number };
type WordInput = { word_id: string; paragraph_id: string; start_sec: number; end_sec: number };
type BeatInput = { index: number; time_sec: number };

export function buildSectionMapFromEvidence(input: {
  durationSec: number;
  scenes: SceneInput[];
  words: WordInput[];
  beats: BeatInput[];
}) {
  return {
    schema_version: 1,
    duration_sec: input.durationSec,
    sections: input.scenes.map((scene) => {
      const sectionWords = input.words.filter((word) => word.start_sec >= scene.start_sec && word.end_sec <= scene.end_sec);
      const sectionBeats = input.beats.filter((beat) => beat.time_sec >= scene.start_sec && beat.time_sec <= scene.end_sec);
      return {
        section_id: scene.section_ids[0] ?? scene.scene_id,
        start_sec: scene.start_sec,
        end_sec: scene.end_sec,
        duration_sec: round(scene.end_sec - scene.start_sec),
        lyric_paragraph_ids: [...new Set(sectionWords.map((word) => word.paragraph_id))],
        word_range: {
          start_word_id: sectionWords[0]?.word_id ?? null,
          end_word_id: sectionWords.at(-1)?.word_id ?? null,
        },
        beat_range: {
          start_index: sectionBeats[0]?.index ?? null,
          end_index: sectionBeats.at(-1)?.index ?? null,
        },
        energy_summary: { mean: null, peak: null },
        alignment_confidence: 1,
        evidence: {
          nearest_beat_boundary_drift_sec: 0,
          nearest_onset_boundary_drift_sec: null,
          energy_boundary_hint: false,
        },
      };
    }),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
```

- [ ] **Step 4: Run section map tests**

Run: `node --experimental-strip-types --test tests/section-map-builder.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib/section-map/section-map-builder.ts tests/section-map-builder.test.ts
git commit -m "Add section map builder"
```

---

## Task 6: Image Generation Adapter And Lock Gate

**Files:**
- Create: `src/lib/image-generation/types.ts`
- Create: `src/lib/image-generation/codex-image-gen-adapter.ts`
- Create: `src/lib/image-generation/image-assets.ts`
- Test: `tests/image-generation-assets.test.ts`

- [ ] **Step 1: Write image asset tests**

Create `tests/image-generation-assets.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLockedImageAssets } from "../src/lib/image-generation/image-assets.ts";

test("writes only locked image candidates into image assets", () => {
  const manifest = buildLockedImageAssets({
    smallProjectId: "media_e2e_v2_portrait_9x16",
    decisions: [
      { candidateId: "cand_001", sceneId: "scene_001_hook", role: "background", path: "assets/images/generated/bg.png", sha256: "abc", prompt: "no text", status: "locked" },
      { candidateId: "cand_002", sceneId: "scene_001_hook", role: "background", path: "assets/images/generated/reject.png", sha256: "def", prompt: "no text", status: "rejected" }
    ]
  });

  assert.equal(manifest.assets.length, 1);
  assert.equal(manifest.assets[0]?.asset_id, "cand_001");
});
```

- [ ] **Step 2: Run failing image tests**

Run: `node --experimental-strip-types --test tests/image-generation-assets.test.ts`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement adapter types and lock gate**

Create `src/lib/image-generation/types.ts`:

```ts
export type ImageGenerationRequest = {
  requestId: string;
  sceneId: string;
  assetRole: "background";
  prompt: string;
  referenceAssetIds: string[];
  aspectRatio: "9:16" | "16:9" | "1:1";
  targetSize: { width: number; height: number };
  variants: number;
  outputDir: string;
};

export type ImageGenerationResult = {
  requestId: string;
  adapterId: string;
  status: "succeeded" | "failed";
  candidates: Array<{ candidateId: string; path: string; sha256: string; width: number; height: number; provenance: Record<string, unknown> }>;
  diagnostics?: string[];
};

export type ImageGenerationAdapter = {
  id: string;
  generateImageCandidates(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
};
```

Create `src/lib/image-generation/image-assets.ts`:

```ts
type Decision = {
  candidateId: string;
  sceneId: string;
  role: "background";
  path: string;
  sha256: string;
  prompt: string;
  status: "locked" | "rejected" | "skipped";
};

export function buildLockedImageAssets(input: { smallProjectId: string; decisions: Decision[] }) {
  return {
    schema_version: 1,
    small_project_id: input.smallProjectId,
    assets: input.decisions.filter((decision) => decision.status === "locked").map((decision) => ({
      asset_id: decision.candidateId,
      scene_id: decision.sceneId,
      role: decision.role,
      path: decision.path,
      sha256: decision.sha256,
      source: "codex_image_gen",
      status: "locked",
      prompt: decision.prompt,
      created_at: new Date().toISOString(),
    })),
  };
}
```

Create `src/lib/image-generation/codex-image-gen-adapter.ts`:

```ts
import type { ImageGenerationAdapter, ImageGenerationRequest, ImageGenerationResult } from "./types.ts";

export const codexImageGenAdapter: ImageGenerationAdapter = {
  id: "codex_image_gen",
  async generateImageCandidates(_request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    throw new Error("Codex image_gen adapter requires a configured invocation before full E2E execution");
  },
};
```

- [ ] **Step 4: Run image tests**

Run: `node --experimental-strip-types --test tests/image-generation-assets.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib/image-generation tests/image-generation-assets.test.ts
git commit -m "Add image generation lock gate"
```

---

## Task 7: Frame Output Validation

**Files:**
- Create: `src/lib/video-html/frame-output-validator.ts`
- Create: `src/lib/video-html/html-video-agent-runtime.ts`
- Modify: `src/lib/video-html/qivance-frame-contracts.ts`
- Test: `tests/html-video-frame-output-validator.test.ts`

- [ ] **Step 1: Write frame validator tests**

Create `tests/html-video-frame-output-validator.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateFrameHtmlReferences } from "../src/lib/video-html/frame-output-validator.ts";

test("rejects external image references", () => {
  const result = validateFrameHtmlReferences({
    html: `<img src="https://example.com/bg.png">`,
    allowedLocalImagePaths: ["assets/images/generated/bg.png"]
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /external image/);
});

test("accepts locked local image references", () => {
  const result = validateFrameHtmlReferences({
    html: `<img src="assets/images/generated/bg.png">`,
    allowedLocalImagePaths: ["assets/images/generated/bg.png"]
  });

  assert.equal(result.ok, true);
});
```

- [ ] **Step 2: Run failing frame validator tests**

Run: `node --experimental-strip-types --test tests/html-video-frame-output-validator.test.ts`

Expected: FAIL because validator does not exist.

- [ ] **Step 3: Implement frame output validator and agent bridge stub**

Create `src/lib/video-html/frame-output-validator.ts`:

```ts
export function validateFrameHtmlReferences(input: {
  html: string;
  allowedLocalImagePaths: string[];
}): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  for (const match of input.html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    const src = match[1] ?? "";
    if (/^https?:\/\//i.test(src)) issues.push(`external image reference is forbidden: ${src}`);
    if (!/^https?:\/\//i.test(src) && !input.allowedLocalImagePaths.includes(src)) {
      issues.push(`unlocked local image reference is forbidden: ${src}`);
    }
  }
  return { ok: issues.length === 0, issues };
}
```

Create `src/lib/video-html/html-video-agent-runtime.ts`:

```ts
export type HtmlVideoAgentRuntimeInput = {
  projectDir: string;
  agentContextPath: string;
};

export async function runHtmlVideoAgentRuntime(_input: HtmlVideoAgentRuntimeInput): Promise<void> {
  throw new Error("html-video agent/runtime command is not configured");
}
```

- [ ] **Step 4: Run frame validator tests**

Run: `node --experimental-strip-types --test tests/html-video-frame-output-validator.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib/video-html/frame-output-validator.ts src/lib/video-html/html-video-agent-runtime.ts tests/html-video-frame-output-validator.test.ts
git commit -m "Add html-video frame output validation"
```

---

## Task 8: MP3 To AAC Mux And ffprobe Fields

**Files:**
- Modify: `src/lib/export/ffprobe.ts`
- Modify: `src/lib/export/mux-locked-audio.ts`
- Test: `tests/mux-locked-audio-mp3.test.ts`

- [ ] **Step 1: Write mux command tests**

Create `tests/mux-locked-audio-mp3.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMuxLockedAudioCommand } from "../src/lib/export/mux-locked-audio.ts";

test("builds mp3 to AAC mux command", () => {
  const args = buildMuxLockedAudioCommand({
    visualPath: "exports/visual_silent.mp4",
    audioPath: "audio/master/active_music_take.mp3",
    outputPath: "exports/final.mp4"
  });

  assert.deepEqual(args, [
    "-y",
    "-i", "exports/visual_silent.mp4",
    "-i", "audio/master/active_music_take.mp3",
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    "exports/final.mp4"
  ]);
});
```

- [ ] **Step 2: Run failing mux test**

Run: `node --experimental-strip-types --test tests/mux-locked-audio-mp3.test.ts`

Expected: FAIL until command builder supports V2 mp3/AAC semantics.

- [ ] **Step 3: Implement command builder**

Modify `src/lib/export/mux-locked-audio.ts` to export:

```ts
export function buildMuxLockedAudioCommand(input: {
  visualPath: string;
  audioPath: string;
  outputPath: string;
}): string[] {
  return [
    "-y",
    "-i", input.visualPath,
    "-i", input.audioPath,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    input.outputPath,
  ];
}
```

Keep existing exports intact. If the file already has a command builder, adapt it to call this function.

- [ ] **Step 4: Run mux test**

Run: `node --experimental-strip-types --test tests/mux-locked-audio-mp3.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib/export/mux-locked-audio.ts tests/mux-locked-audio-mp3.test.ts
git commit -m "Mux locked MP3 audio as AAC"
```

---

## Task 9: V2 Render Manifest

**Files:**
- Create: `src/lib/export/render-manifest-v2.ts`
- Test: `tests/render-manifest-v2.test.ts`

- [ ] **Step 1: Write manifest test**

Create `tests/render-manifest-v2.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRenderManifestV2 } from "../src/lib/export/render-manifest-v2.ts";

test("builds a V2 manifest with required evidence sections", () => {
  const manifest = buildRenderManifestV2({
    projectId: "media_e2e_v2_portrait_9x16",
    aspectRatio: "9:16",
    resolution: { width: 1080, height: 1920 },
    fps: 30,
    workflowRunId: "run_001",
    status: "passed"
  });

  assert.equal(manifest.schema_version, 2);
  assert.equal(manifest.word_alignment.metrics.word_coverage, null);
  assert.equal(manifest.mux.final_audio_codec, "aac");
});
```

- [ ] **Step 2: Run failing manifest test**

Run: `node --experimental-strip-types --test tests/render-manifest-v2.test.ts`

Expected: FAIL because manifest module does not exist.

- [ ] **Step 3: Implement V2 manifest builder**

Create `src/lib/export/render-manifest-v2.ts`:

```ts
export function buildRenderManifestV2(input: {
  projectId: string;
  aspectRatio: "9:16" | "16:9" | "1:1";
  resolution: { width: number; height: number };
  fps: number;
  workflowRunId: string;
  status: "passed" | "failed";
}) {
  return {
    schema_version: 2,
    project_id: input.projectId,
    aspect_ratio: input.aspectRatio,
    resolution: input.resolution,
    fps: input.fps,
    workflow_run_id: input.workflowRunId,
    status: input.status,
    steps: [],
    inputs: {},
    audio_analysis: {},
    word_alignment: {
      backend: "whisperx",
      metrics: {
        word_coverage: null,
        low_confidence_ratio: null,
        unmatched_ratio: null,
        section_duration_coverage: null,
        section_boundary_evidence_drift_sec: null,
      },
    },
    image_generation: {},
    html_video: {},
    render: { duration_mode: "explicit" },
    mux: { source_audio_codec: "mp3", final_audio_codec: "aac" },
    qa: {},
    diagnostics: [],
  };
}
```

- [ ] **Step 4: Run manifest test**

Run: `node --experimental-strip-types --test tests/render-manifest-v2.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib/export/render-manifest-v2.ts tests/render-manifest-v2.test.ts
git commit -m "Add V2 render manifest evidence"
```

---

## Task 10: Wire Workflow With Mockable Dependencies

**Files:**
- Modify: `src/lib/media-e2e/workflow.ts`
- Test: `tests/media-e2e-workflow.test.ts`

- [ ] **Step 1: Add orchestration test with injected steps**

Extend `tests/media-e2e-workflow.test.ts`:

```ts
import { runMediaE2EWorkflowWithInjectedSteps } from "../src/lib/media-e2e/workflow.ts";

test("runs injected workflow steps in order", async () => {
  const calls: string[] = [];
  await runMediaE2EWorkflowWithInjectedSteps({
    steps: {
      validate_fixture_bundle: async () => calls.push("validate_fixture_bundle"),
      analyze_audio_with_librosa: async () => calls.push("analyze_audio_with_librosa"),
      align_words_with_whisperx: async () => calls.push("align_words_with_whisperx"),
      build_section_map: async () => calls.push("build_section_map"),
      generate_background_images: async () => calls.push("generate_background_images"),
      review_and_lock_image_assets: async () => calls.push("review_and_lock_image_assets"),
      write_html_video_workspace: async () => calls.push("write_html_video_workspace"),
      run_html_video_agent_runtime: async () => calls.push("run_html_video_agent_runtime"),
      validate_frame_outputs: async () => calls.push("validate_frame_outputs"),
      static_preview_smoke: async () => calls.push("static_preview_smoke"),
      render_visual_with_html_video: async () => calls.push("render_visual_with_html_video"),
      mux_active_mp3_to_final_aac: async () => calls.push("mux_active_mp3_to_final_aac"),
      ffprobe_visual_and_final: async () => calls.push("ffprobe_visual_and_final"),
      write_render_manifest: async () => calls.push("write_render_manifest"),
      append_test_report_evidence: async () => calls.push("append_test_report_evidence")
    }
  });

  assert.deepEqual(calls, [...MEDIA_E2E_WORKFLOW_STEPS]);
});
```

- [ ] **Step 2: Run failing workflow orchestration test**

Run: `node --experimental-strip-types --test tests/media-e2e-workflow.test.ts`

Expected: FAIL because injected runner does not exist.

- [ ] **Step 3: Implement injected workflow runner**

Modify `src/lib/media-e2e/workflow.ts`:

```ts
export type InjectedMediaE2ESteps = Record<MediaE2EWorkflowStep, () => Promise<unknown>>;

export async function runMediaE2EWorkflowWithInjectedSteps(input: { steps: InjectedMediaE2ESteps }): Promise<void> {
  for (const step of MEDIA_E2E_WORKFLOW_STEPS) {
    await input.steps[step]();
  }
}
```

- [ ] **Step 4: Run workflow tests**

Run: `node --experimental-strip-types --test tests/media-e2e-workflow.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib/media-e2e/workflow.ts tests/media-e2e-workflow.test.ts
git commit -m "Wire media E2E workflow order"
```

---

## Task 11: Local E2E Script And TEST_REPORT Evidence

**Files:**
- Create: `scripts/e2e-media-v2.ts`
- Create: `src/lib/media-e2e/test-report.ts`
- Modify: `package.json` if adding a script is useful

- [ ] **Step 1: Add test-report writer**

Create `src/lib/media-e2e/test-report.ts`:

```ts
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export async function appendMediaE2ETestReportEvidence(input: {
  reportPath: string;
  ratio: string;
  manifestPath: string;
  status: "passed" | "failed";
}): Promise<void> {
  await mkdir(dirname(input.reportPath), { recursive: true });
  await appendFile(input.reportPath, [
    `## ${input.ratio}`,
    "",
    `- Status: ${input.status}`,
    `- Manifest: ${input.manifestPath}`,
    "",
  ].join("\n"));
}
```

- [ ] **Step 2: Add local E2E script**

Create `scripts/e2e-media-v2.ts`:

```ts
import { runMediaE2EWorkflow } from "../src/lib/media-e2e/workflow.ts";

const fixture = process.argv[process.argv.indexOf("--fixture") + 1];
if (!fixture) {
  console.error("usage: scripts/e2e-media-v2.ts --fixture <portrait-9x16|landscape-16x9|square-1x1>");
  process.exit(2);
}

await runMediaE2EWorkflow();
```

This script is intentionally minimal until the workflow implementation is complete.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS or existing project-specific typecheck result. If it fails because `runMediaE2EWorkflow` is still intentionally stubbed, adjust the script to call the final workflow signature in the implementation task that unstubs it.

- [ ] **Step 4: Commit**

Run:

```bash
git add scripts/e2e-media-v2.ts src/lib/media-e2e/test-report.ts
git commit -m "Add media E2E script entrypoint"
```

---

## Task 12: Full Verification And Documentation

**Files:**
- Create: `fixtures/media-e2e-v2/portrait-9x16/*`
- Create: `fixtures/media-e2e-v2/landscape-16x9/*`
- Create: `fixtures/media-e2e-v2/square-1x1/*`
- Create: `docs/TEST_REPORT.v2.md`
- Modify: `docs/requirements traceability matrix.md`

- [ ] **Step 1: Add three real fixture bundles**

Create each fixture with:

```text
active_music_take.mp3
lyrics.md
animation_plan.json
image_generation_plan.json
```

Use 20-40 second real samples, at least 3 sections, and at least one background image generation request per fixture.

- [ ] **Step 2: Run standard verification**

Run:

```bash
pnpm typecheck
pnpm test
node --experimental-strip-types --test tests/*.test.ts
pnpm -r build
```

Expected: all pass. Record exact results in `docs/TEST_REPORT.v2.md`.

- [ ] **Step 3: Run local full media E2E**

Run:

```bash
node --experimental-strip-types scripts/e2e-media-v2.ts --fixture portrait-9x16
node --experimental-strip-types scripts/e2e-media-v2.ts --fixture landscape-16x9
node --experimental-strip-types scripts/e2e-media-v2.ts --fixture square-1x1
```

Expected:

```text
projects/media_e2e_v2_portrait_9x16/exports/render_manifest.json status passed
projects/media_e2e_v2_landscape_16x9/exports/render_manifest.json status passed
projects/media_e2e_v2_square_1x1/exports/render_manifest.json status passed
```

- [ ] **Step 4: Write TEST_REPORT.v2**

Create `docs/TEST_REPORT.v2.md` with:

```markdown
# TEST_REPORT.v2

Date: 2026-06-09
Scope: V2 media E2E hardening.

## Commands

- `pnpm typecheck`: result
- `pnpm test`: result
- `node --experimental-strip-types --test tests/*.test.ts`: result
- `pnpm -r build`: result
- `node --experimental-strip-types scripts/e2e-media-v2.ts --fixture portrait-9x16`: result
- `node --experimental-strip-types scripts/e2e-media-v2.ts --fixture landscape-16x9`: result
- `node --experimental-strip-types scripts/e2e-media-v2.ts --fixture square-1x1`: result

## Manifest Evidence

- portrait-9x16: `projects/media_e2e_v2_portrait_9x16/exports/render_manifest.json`
- landscape-16x9: `projects/media_e2e_v2_landscape_16x9/exports/render_manifest.json`
- square-1x1: `projects/media_e2e_v2_square_1x1/exports/render_manifest.json`

## Conclusion

State whether V2 media E2E is complete. Any unproven path must be named.
```

- [ ] **Step 5: Update requirements traceability matrix**

Update `docs/requirements traceability matrix.md` so V2 decisions align with the new media E2E scope:

```text
- DeepSeek/MiniMax/RAG/workbench rows: move out of V2 P0.
- timing/parser rows: V2 implemented or tested.
- image generation rows: V2 implemented or tested.
- render/mux/manifest rows: V2 implemented or tested.
- Preview revise rows: moved to later version.
```

- [ ] **Step 6: Run GitNexus final checks**

Run:

```bash
npx gitnexus analyze
npx gitnexus detect-changes --repo qivance-music
```

Expected: changes match V2 media E2E symbols and flows. Investigate any unexpected high-risk relationships before committing.

- [ ] **Step 7: Commit**

Run:

```bash
git add src scripts tests fixtures docs package.json
git commit -m "Add V2 media E2E workflow"
```

---

## Self-Review

Spec coverage:

```text
- Fixture contract: Tasks 1 and 12.
- Workflow/checkpoints: Tasks 2 and 10.
- librosa audio analysis: Task 3.
- WhisperX word timing and quality gates: Task 4.
- section_map generation: Task 5.
- image generation adapter and lock gate: Task 6.
- html-video runtime boundary and frame validation: Task 7.
- mp3 -> AAC mux: Task 8.
- render_manifest evidence: Task 9.
- local E2E script and TEST_REPORT: Tasks 11 and 12.
- CI/mock coverage: Tasks 1-11 tests.
```

Known implementation-level choices left for execution:

```text
- exact WhisperX model size.
- exact WhisperX compute_type.
- actual Codex image_gen adapter invocation.
- exact fixture content and media source.
```

