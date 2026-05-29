# Issue #2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pasted storyboard import, visible gate progress, and an embedded official HyperFrames CLI preview UI that replaces the old Qivance inline video preview.

**Architecture:** Keep the existing Node HTTP server and static HTML renderer. Add three focused modules: storyboard import/gating, gate progress loading, and HyperFrames CLI preview process management. Wire them into the current project workspace page and server routes without adding a frontend framework.

**Tech Stack:** Node.js 24 strip-types TypeScript, `node:test`, filesystem JSON artifacts, HyperFrames CLI `preview --port --no-open`, existing Qivance project directory layout.

---

### Task 1: Storyboard Import Module

**Files:**
- Create: `src/lib/storyboard-import.ts`
- Test: `tests/storyboard-import.test.ts`

- [ ] **Step 1: Write failing validation tests**

Add tests that call `validateStoryboardPayload()` with overlapping scenes and non-finite timing. They must fail because the module does not exist yet.

Run: `TMPDIR=/tmp npm test`
Expected: FAIL with module-not-found or export-not-found for `storyboard-import.ts`.

- [ ] **Step 2: Implement the minimal parser and validator**

Create `validateStoryboardPayload(value: unknown)` returning `{ scenes, captions, visuals }` or throwing an `Error` with blocking issue text. Accept only top-level `scenes`, optional `captions`, and optional `visuals`.

Run: `TMPDIR=/tmp npm test`
Expected: the new validation tests pass.

- [ ] **Step 3: Add failing artifact-write test**

Add a test that creates a temp project with `project_manifest.json` and `workflow_snapshot.json`, calls `importStoryboardFromJson({ projectPath, storyboardJson })`, then expects canonical storyboard JSON files and `qa/storyboard/scene_rule_check.json`.

Run: `TMPDIR=/tmp npm test`
Expected: FAIL because the write function is missing.

- [ ] **Step 4: Implement import writes**

Write `data/storyboard/scene_plan.json`, `caption_plan.json`, `visual_plan.json`, `qa/storyboard/scene_rule_check.json`, update `project_manifest.json` to `scene_waiting_human`, and update `workflow_snapshot.json` with `next_allowed_actions: ["approve_scene"]`.

Run: `TMPDIR=/tmp npm test`
Expected: all tests pass.

### Task 2: Gate Progress Module

**Files:**
- Create: `src/lib/gate-progress.ts`
- Test: `tests/gate-progress.test.ts`

- [ ] **Step 1: Write failing progress tests**

Create a temp project with selected QA reports and assert `loadGateProgress(projectPath)` returns six stages: `music_ingest`, `beat_lock`, `timing_schema`, `storyboard_gate`, `hypeframes_project`, and `hyperframes_ui`.

Run: `TMPDIR=/tmp npm test`
Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement QA-to-progress mapping**

Read existing QA JSON files if present. Map `rule_pass` and `human_approved` to `pass`, `human_pending` and `rule_pass_with_warnings` to `warning`, `rule_fail_blocked` to `fail`, workflow-active states to `running`, and missing artifacts to `pending`.

Run: `TMPDIR=/tmp npm test`
Expected: all tests pass.

### Task 3: HyperFrames UI Process Module

**Files:**
- Create: `src/lib/hyperframes-ui.ts`
- Test: `tests/hyperframes-ui.test.ts`

- [ ] **Step 1: Write failing URL/runtime tests**

Test that a runtime URL uses the request host without the Qivance port, includes the selected HyperFrames port, and ends with `/#project/hypeframes`. Test that runtime metadata is written to `logs/hyperframes_ui.json`.

Run: `TMPDIR=/tmp npm test`
Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement testable helpers and runtime persistence**

Implement `buildHyperframesStudioUrl()`, `loadHyperframesUiStatus()`, and `writeHyperframesUiRuntime()`.

Run: `TMPDIR=/tmp npm test`
Expected: helper tests pass.

- [ ] **Step 3: Add failing start test with injected spawner**

Add a test for `startHyperframesUi()` using an injected spawn function so no real process starts. Assert command args include `preview`, `--port`, the selected port, `--no-open`, and `.`.

Run: `TMPDIR=/tmp npm test`
Expected: FAIL until process startup is implemented.

- [ ] **Step 4: Implement process startup**

Resolve `HYPERFRAMES_BIN`, then the known global binary path, then cached `_npx`, then `npx --no-install hyperframes`. Start the child in `<project>/hypeframes`, persist runtime metadata, and reuse a live existing PID.

Run: `TMPDIR=/tmp npm test`
Expected: all tests pass.

### Task 4: Workspace UI Rendering

**Files:**
- Modify: `src/lib/web-ui.ts`
- Test: `tests/web-ui.test.ts`

- [ ] **Step 1: Run GitNexus impact**

Run: `npx gitnexus impact --repo qivance-music renderProjectWorkspace`
Run: `npx gitnexus impact --repo qivance-music loadProjectSummary`
Expected: note direct callers and risk before editing.

- [ ] **Step 2: Write failing UI tests**

Extend `tests/web-ui.test.ts` to assert the project workspace includes a gate progress bar, a storyboard paste textarea/form, a HyperFrames UI start form, optional iframe/direct URL when runtime exists, and no `<video controls`.

Run: `TMPDIR=/tmp npm test`
Expected: FAIL because the UI has not changed.

- [ ] **Step 3: Implement minimal HTML changes**

Load gate progress and HyperFrames UI status in `loadProjectSummary()`. Render progress, paste form, HyperFrames panel, and remove the old `<video>` preview panel.

Run: `TMPDIR=/tmp npm test`
Expected: all tests pass.

### Task 5: Server Routes

**Files:**
- Modify: `src/server.ts`
- Test: `tests/web-ui.test.ts` or a new focused server route test if needed

- [ ] **Step 1: Run GitNexus impact**

Run: `npx gitnexus impact --repo qivance-music route`
Expected: note direct callers and risk before editing.

- [ ] **Step 2: Add failing route behavior tests if route helpers can be tested directly**

Prefer direct tests for exported helper functions only. If the server routes remain private, rely on module tests and HTML tests instead of starting a long-lived server in unit tests.

Run: `TMPDIR=/tmp npm test`
Expected: current tests pass or fail only for missing route wiring.

- [ ] **Step 3: Wire routes**

Add `POST /projects/:id/storyboard/import` and `POST /projects/:id/hyperframes-ui/start`. On invalid storyboard JSON, render the project workspace with the error message. On missing HypeFrames files or startup failure, render the project workspace with the error message. Add `GET /projects/:id/hyperframes-ui/status` returning JSON.

Run: `TMPDIR=/tmp npm test`
Expected: all tests pass.

### Task 6: Verification and Commit

**Files:**
- Verify: all changed files

- [ ] **Step 1: Run full tests**

Run: `TMPDIR=/tmp npm test`
Expected: PASS.

- [ ] **Step 2: Run GitNexus detect changes**

Run: `npx gitnexus detect-changes --repo qivance-music`
Expected: affected symbols match issue #2 modules, `web-ui.ts`, and `server.ts`.

- [ ] **Step 3: Refresh GitNexus if stale**

Run: `npx gitnexus analyze`
Expected: index up to date. If sandbox blocks registry writes, rerun with escalated permissions.

- [ ] **Step 4: Commit**

Run:
```bash
git add -f docs/superpowers/plans/2026-05-29-issue-2-implementation.md
git add src/lib/storyboard-import.ts src/lib/gate-progress.ts src/lib/hyperframes-ui.ts src/lib/web-ui.ts src/server.ts tests/storyboard-import.test.ts tests/gate-progress.test.ts tests/hyperframes-ui.test.ts tests/web-ui.test.ts
git commit -m "Add issue 2 HyperFrames UI workflow"
```
