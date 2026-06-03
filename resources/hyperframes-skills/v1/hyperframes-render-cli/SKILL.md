---
name: hyperframes-render-cli
description: Use this skill when validating or rendering a local HyperFrames project with the local HyperFrames CLI, render targets, preview output, review output, and deterministic file checks.
---

# HyperFrames Render CLI

Run lint or inspect first, then render. Do not fake success when the local CLI is unavailable.
`preview_composite.mp4` is the first deliverable. `preview_composite_review.mp4` is for internal review.
Review markers are allowed only in review targets.

Forbidden paths remain forbidden: `audio/**`, `data/timing/**`, `data/lyrics/**`, `project_manifest.json`, `workflow_snapshot.json`, `dist/**`, `qa/music/**`, `qa/timing/**`.
