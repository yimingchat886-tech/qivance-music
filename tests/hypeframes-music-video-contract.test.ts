import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runHypeframesMusicVideoContractGate } from "../src/lib/hypeframes-music-video-contract-gate.ts";

test("Music Video Contract Gate passes a deterministic music-conditioned composition", async () => {
  const projectPath = await writeContractFixture();

  await runHypeframesMusicVideoContractGate(projectPath);

  const report = await readReport(projectPath);
  assert.equal(report.status, "rule_pass");
  assert.deepEqual(report.blocking_issues, []);
});

test("Music Video Contract Gate blocks missing context and nondeterministic source", async () => {
  const projectPath = await writeContractFixture();
  await writeFileAt(projectPath, "hypeframes/generated/agent_context.json", "");
  await writeFileAt(projectPath, "hypeframes/src/main.js", "window.__timelines={}; Math.random();");

  await runHypeframesMusicVideoContractGate(projectPath);

  const report = await readReport(projectPath);
  assert.equal(report.status, "rule_fail_blocked");
  assert.match(report.blocking_issues.join(" "), /agent_context/);
  assert.match(report.blocking_issues.join(" "), /Math\.random/);
});

async function writeContractFixture(): Promise<string> {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-music-contract-"));
  await writeJson(projectPath, "audio/music_manifest.json", { duration_sec: 10, sha256: "hash-ok" });
  await writeFileAt(projectPath, "audio/master/minimax_rap_master.wav", "audio");
  await writeFileAt(projectPath, "hypeframes/public_assets/audio/minimax_rap_master.wav", "audio");
  await writeJson(projectPath, "data/timing/section_map.json", { duration_sec: 10, sections: [] });
  await writeJson(projectPath, "data/storyboard/caption_plan.json", { captions: [] });
  await writeJson(projectPath, "hypeframes/generated/agent_context.json", {
    schema_version: "qivance.hypeframes.agent_context.v1",
    track: { duration_sec: 10, master_audio_path: "audio/master/minimax_rap_master.wav" },
  });
  await writeFileAt(projectPath, "hypeframes/src/index.html", "<audio src=\"public_assets/audio/minimax_rap_master.wav\"></audio>");
  await writeFileAt(projectPath, "hypeframes/src/styles.css", "body{color:white}");
  await writeFileAt(projectPath, "hypeframes/src/main.js", "window.__timelines={main:{}};");
  await writeJson(projectPath, "hypeframes/src/config.json", {
    duration_sec: 10,
    width: 1080,
    height: 1920,
    fps: 30,
    audio_path: "public_assets/audio/minimax_rap_master.wav",
  });
  return projectPath;
}

async function readReport(projectPath: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(path.join(projectPath, "qa", "hypeframes", "hypeframes_music_video_contract_qa_report.json"), "utf8"),
  );
}

async function writeJson(projectPath: string, relativePath: string, value: unknown): Promise<void> {
  await writeFileAt(projectPath, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeFileAt(projectPath: string, relativePath: string, value: string): Promise<void> {
  const filePath = path.join(projectPath, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}
