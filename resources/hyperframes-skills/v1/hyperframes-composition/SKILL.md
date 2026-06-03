---
name: hyperframes-composition
description: Use this skill when editing Qivance HyperFrames video HTML composition, scene components, captions, visual nodes, beat cues, or styles. Only modify HypeFrames project files and preserve beats.locked.json as the timing source of truth.
---

# HyperFrames Composition

Only edit `hypeframes/**`, `qa/hypeframes/hypeframes_revision_notes.md`, and `logs/codex/**`.
beats.locked.json is the single timing source of truth.

Do not modify:

- `audio/**`
- `data/timing/**`
- `data/lyrics/**`
- `project_manifest.json`
- `workflow_snapshot.json`
- `dist/**`
- `qa/music/**`
- `qa/timing/**`

No external URLs. No non-reproducible randomness. Preview-first. Review-only markers must not appear in preview targets.
