#!/usr/bin/env -S node --experimental-strip-types
import process from "node:process";
import {
  generateImageCandidatesViaParentWrapper,
  parseImageGenerationRequest,
} from "../src/lib/image-generation/codex-exec-image-gen-parent-wrapper.ts";

async function main(): Promise<void> {
  const stdin = await readStdin();
  const request = parseImageGenerationRequest(stdin);
  const result = await generateImageCandidatesViaParentWrapper(request);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
