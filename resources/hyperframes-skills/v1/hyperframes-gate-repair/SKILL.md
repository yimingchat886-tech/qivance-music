---
name: hyperframes-gate-repair
description: Use this skill when repairing HypeFrames File QA failures, Codex forbidden path failures, render target mismatches, missing local assets, unsafe external URLs, or timing alignment warnings.
---

# HyperFrames Gate Repair

Fix only problems named by Gate reports. Do not redesign content subjectively.
After repair, write `qa/hypeframes/hypeframes_revision_notes.md` and rerun the relevant Gate.
Do not modify forbidden paths: `audio/**`, `data/timing/**`, `data/lyrics/**`, `project_manifest.json`, `workflow_snapshot.json`, `dist/**`, `qa/music/**`, `qa/timing/**`.
