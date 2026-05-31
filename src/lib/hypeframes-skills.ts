import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "./fs-utils.ts";
import { writeQaReport } from "./gate-report.ts";

const skills = [
  {
    dir: "hyperframes-composition",
    skill: `---
name: hyperframes-composition
description: Use this skill when editing Qivance HyperFrames video HTML composition, scene components, captions, visual nodes, beat cues, or styles. Only modify HypeFrames project files and preserve beats.locked.json as the timing source of truth.
---

# HyperFrames Composition

Only edit \`hypeframes/**\`, \`qa/hypeframes/hypeframes_revision_notes.md\`, and \`logs/codex/**\`.
beats.locked.json is the single timing source of truth.

Do not modify:

- \`audio/**\`
- \`data/timing/**\`
- \`data/lyrics/**\`
- \`project_manifest.json\`
- \`workflow_snapshot.json\`
- \`dist/**\`
- \`qa/music/**\`
- \`qa/timing/**\`

No external URLs. No non-reproducible randomness. Preview-first. Review-only markers must not appear in preview targets.
`,
    referenceName: "project-contract.md",
    reference: `# Project Contract

HypeFrames owns the video HTML composition only. The locked beat grid and section map are read-only inputs.
`,
  },
  {
    dir: "hyperframes-render-cli",
    skill: `---
name: hyperframes-render-cli
description: Use this skill when validating or rendering a local HyperFrames project with the local HyperFrames CLI, render targets, preview output, review output, and deterministic file checks.
---

# HyperFrames Render CLI

Run lint or inspect first, then render. Do not fake success when the local CLI is unavailable.
\`preview_composite.mp4\` is the first deliverable. \`preview_composite_review.mp4\` is for internal review.
Review markers are allowed only in review targets.

Forbidden paths remain forbidden: \`audio/**\`, \`data/timing/**\`, \`data/lyrics/**\`, \`project_manifest.json\`, \`workflow_snapshot.json\`, \`dist/**\`, \`qa/music/**\`, \`qa/timing/**\`.
`,
    referenceName: "render-targets.md",
    reference: `# Render Targets

The preview target must be clean. The review target may include overlays and markers.
`,
  },
  {
    dir: "hyperframes-gate-repair",
    skill: `---
name: hyperframes-gate-repair
description: Use this skill when repairing HypeFrames File QA failures, Codex forbidden path failures, render target mismatches, missing local assets, unsafe external URLs, or timing alignment warnings.
---

# HyperFrames Gate Repair

Fix only problems named by Gate reports. Do not redesign content subjectively.
After repair, write \`qa/hypeframes/hypeframes_revision_notes.md\` and rerun the relevant Gate.
Do not modify forbidden paths: \`audio/**\`, \`data/timing/**\`, \`data/lyrics/**\`, \`project_manifest.json\`, \`workflow_snapshot.json\`, \`dist/**\`, \`qa/music/**\`, \`qa/timing/**\`.
`,
    referenceName: "gate-contract.md",
    reference: `# Gate Contract

Gate reports are the only source for repair scope. Do not claim QA passed unless the rule report exists.
`,
  },
];

export async function ensureHyperframesSkills(projectPath: string): Promise<{
  skillPaths: string[];
  qaReportPath: string;
}> {
  const skillPaths: string[] = [];
  for (const skill of skills) {
    const skillDir = path.join(projectPath, "hypeframes", ".agents", "skills", skill.dir);
    const referenceDir = path.join(skillDir, "references");
    await ensureDir(referenceDir);
    const skillPath = path.join(skillDir, "SKILL.md");
    const referencePath = path.join(referenceDir, skill.referenceName);
    await writeFile(skillPath, skill.skill, "utf8");
    await writeFile(referencePath, skill.reference, "utf8");
    skillPaths.push(path.relative(projectPath, skillPath).split(path.sep).join("/"));
  }

  const blockingIssues = await validateSkills(projectPath, skillPaths);
  const qaReportPath = "qa/hypeframes/hyperframes_skills_qa_report.json";
  await writeQaReport(projectPath, qaReportPath, {
    gate_name: "HyperFrames Skills QA",
    status: blockingIssues.length > 0 ? "rule_fail_blocked" : "rule_pass",
    blocking_issues: blockingIssues,
    input_artifacts: skillPaths,
    output_artifacts: [qaReportPath],
  });
  return { skillPaths, qaReportPath };
}

async function validateSkills(projectPath: string, skillPaths: string[]): Promise<string[]> {
  const blockingIssues: string[] = [];
  for (const relativePath of skillPaths) {
    const text = await readFile(path.join(projectPath, relativePath), "utf8");
    if (!/^---\n[\s\S]*?\n---/m.test(text)) {
      blockingIssues.push(`${relativePath} is missing frontmatter.`);
    }
    if (!/^name:\s*\S+/m.test(text) || !/^description:\s*\S+/m.test(text)) {
      blockingIssues.push(`${relativePath} frontmatter must include name and description.`);
    }
    if (!text.includes("audio/**") || !text.includes("data/timing/**") || !text.includes("dist/**")) {
      blockingIssues.push(`${relativePath} is missing forbidden path rules.`);
    }
    if (/OPENAI_API_KEY|CODEX_API_KEY|auth\.json/i.test(text)) {
      blockingIssues.push(`${relativePath} contains secret-like content.`);
    }
    if (/self[- ]?review content quality|subjective quality/i.test(text)) {
      blockingIssues.push(`${relativePath} asks Codex to self-review subjective content quality.`);
    }
  }
  return blockingIssues;
}
