import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runTimingSchemaGate } from "../src/lib/timing-schema-gate.ts";

test("Timing Schema Gate passes valid timing artifacts", async () => {
  const projectPath = await writeTimingFixture("hash-ok");

  await runTimingSchemaGate(projectPath);

  const report = await readReport(projectPath);
  assert.equal(report.status, "rule_pass");
  assert.deepEqual(report.blocking_issues, []);
});

test("Timing Schema Gate blocks hash mismatch and section overlap", async () => {
  const projectPath = await writeTimingFixture("wrong-hash", [
    { section_id: "sec_001", index: 0, label: "Verse", start_sec: 0, end_sec: 5, lyric_lines: ["a"] },
    { section_id: "sec_002", index: 1, label: "Hook", start_sec: 4.5, end_sec: 10, lyric_lines: ["b"] },
  ]);

  await runTimingSchemaGate(projectPath);

  const report = await readReport(projectPath);
  assert.equal(report.status, "rule_fail_blocked");
  assert.match(report.blocking_issues.join(" "), /audio_hash/);
  assert.match(report.blocking_issues.join(" "), /overlap/);
});

test("Timing Schema Gate warns when hook starts away from a bar", async () => {
  const projectPath = await writeTimingFixture("hash-ok", [
    { section_id: "sec_001", index: 0, label: "Hook", start_sec: 0.7, end_sec: 5, lyric_lines: ["a"] },
  ]);

  await runTimingSchemaGate(projectPath);

  const report = await readReport(projectPath);
  assert.equal(report.status, "rule_pass_with_warnings");
  assert.match(report.warnings.join(" "), /nearest bar/);
});

async function writeTimingFixture(audioHash: string, sections = [
  { section_id: "sec_001", index: 0, label: "Verse", start_sec: 0, end_sec: 4, lyric_lines: ["a"] },
  { section_id: "sec_002", index: 1, label: "Hook", start_sec: 4, end_sec: 10, lyric_lines: ["b"] },
]): Promise<string> {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-timing-gate-"));
  await writeJson(projectPath, "audio/music_manifest.json", { sha256: "hash-ok", duration_sec: 10 });
  await writeJson(projectPath, "data/timing/beats.locked.json", {
    audio_hash: audioHash,
    beats: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    bars: [0, 4, 8],
  });
  await writeJson(projectPath, "data/timing/section_map.json", {
    audio_hash: audioHash,
    duration_sec: 10,
    sections,
  });
  await writeJson(projectPath, "data/timing/section_density_report.json", { sections: [] });
  await writeJson(projectPath, "data/lyrics/lyrics_structured.json", { sections: [] });
  return projectPath;
}

async function readReport(projectPath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(projectPath, "qa", "timing", "timing_qa_report.json"), "utf8"));
}

async function writeJson(projectPath: string, relativePath: string, value: unknown): Promise<void> {
  const filePath = path.join(projectPath, relativePath);
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path.dirname(filePath), { recursive: true }));
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
