import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runHypeframesFileGate } from "../src/lib/hypeframes-file-gate.ts";

test("HypeFrames File Gate passes a complete local project", async () => {
  const projectPath = await writeHypeframesFixture();

  await runHypeframesFileGate(projectPath);

  const report = await readReport(projectPath);
  assert.equal(report.status, "rule_pass");
  assert.deepEqual(report.blocking_issues, []);
});

test("HypeFrames File Gate blocks external URLs", async () => {
  const projectPath = await writeHypeframesFixture();
  await writeFileAt(projectPath, "hypeframes/src/styles.css", "body{background:url('https://example.com/a.png')}");

  await runHypeframesFileGate(projectPath);

  const report = await readReport(projectPath);
  assert.equal(report.status, "rule_fail_blocked");
  assert.match(report.blocking_issues.join(" "), /external URL/);
});

test("HypeFrames File Gate blocks preview targets with review markers", async () => {
  const projectPath = await writeHypeframesFixture();
  await writeJson(projectPath, "hypeframes/render_targets/render_targets.json", {
    preview_composite: { output: "dist/preview/preview_composite.mp4", includes_review_markers: true },
    preview_composite_review: { output: "dist/review/preview_composite_review.mp4", includes_review_markers: true },
  });

  await runHypeframesFileGate(projectPath);

  const report = await readReport(projectPath);
  assert.equal(report.status, "rule_fail_blocked");
  assert.match(report.blocking_issues.join(" "), /preview_composite/);
});

async function writeHypeframesFixture(): Promise<string> {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-hypeframes-gate-"));
  await writeJson(projectPath, "audio/music_manifest.json", { sha256: "hash-ok", duration_sec: 10 });
  await writeFileAt(projectPath, "audio/master/minimax_rap_master.wav", "audio");
  await writeJson(projectPath, "data/timing/beats.locked.json", { audio_hash: "hash-ok" });
  await writeJson(projectPath, "data/timing/section_map.json", { audio_hash: "hash-ok", duration_sec: 10, sections: [] });
  await writeJson(projectPath, "data/storyboard/render_plan.json", { targets: ["preview_composite", "preview_composite_review"] });
  await writeFileAt(projectPath, "hypeframes/src/index.html", "<!doctype html>");
  await writeFileAt(projectPath, "hypeframes/src/styles.css", "body{color:white}");
  await writeFileAt(projectPath, "hypeframes/src/main.js", "window.__timelines={}");
  await writeFileAt(projectPath, "hypeframes/public_assets/audio/minimax_rap_master.wav", "audio");
  await writeJson(projectPath, "hypeframes/src/config.json", {
    duration_sec: 10,
    audio_path: "public_assets/audio/minimax_rap_master.wav",
  });
  await writeJson(projectPath, "hypeframes/generated/timeline.json", { audio_hash: "hash-ok", duration_sec: 10 });
  await writeJson(projectPath, "hypeframes/generated/scene_plan.json", { scenes: [] });
  await writeJson(projectPath, "hypeframes/generated/caption_plan.json", { captions: [] });
  await writeJson(projectPath, "hypeframes/generated/visual_plan.json", { visuals: [] });
  await writeJson(projectPath, "hypeframes/render_targets/render_targets.json", {
    preview_composite: { output: "dist/preview/preview_composite.mp4", includes_review_markers: false },
    preview_composite_review: { output: "dist/review/preview_composite_review.mp4", includes_review_markers: true },
  });
  await writeJson(projectPath, "hypeframes/hypeframes_project_manifest.json", {
    render_targets: ["preview_composite", "preview_composite_review"],
  });
  return projectPath;
}

async function readReport(projectPath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(projectPath, "qa", "hypeframes", "hypeframes_file_qa_report.json"), "utf8"));
}

async function writeFileAt(projectPath: string, relativePath: string, value: string): Promise<void> {
  const filePath = path.join(projectPath, relativePath);
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path.dirname(filePath), { recursive: true }));
  await writeFile(filePath, value, "utf8");
}

async function writeJson(projectPath: string, relativePath: string, value: unknown): Promise<void> {
  await writeFileAt(projectPath, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}
