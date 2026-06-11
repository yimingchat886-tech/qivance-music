import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SmallProjectPaths } from "../project-core/paths.ts";
import type { AnimationPlan } from "../video-contract/animation-plan.schema.ts";
import type { QivanceFrameContract, QivanceFrameContracts } from "../video-html/qivance-frame-contracts.ts";

export async function writeContractFallbackFrames(input: {
  paths: SmallProjectPaths;
  contracts: QivanceFrameContracts;
  animationPlan: AnimationPlan;
  imageAssets: Array<{ scene_id: string; path: string; role: string }>;
}): Promise<string[]> {
  await mkdir(input.paths.framesDir, { recursive: true });
  const written: string[] = [];

  for (const contract of Object.values(input.contracts.frames).sort((a, b) => a.order - b.order)) {
    const framePath = path.join(input.paths.htmlVideoProjectDir, contract.allowedHtmlPath);
    if (await fileExists(framePath)) continue;

    const scene = input.animationPlan.scenes.find((item) => item.id === contract.sceneId);
    const imageAsset = input.imageAssets.find((asset) => asset.scene_id === contract.sceneId && asset.role === "background");
    await writeFile(framePath, buildContractFallbackFrameHtml({
      contract,
      title: scene?.headline ?? contract.sectionId,
      imagePath: imageAsset?.path,
    }), "utf8");
    written.push(contract.allowedHtmlPath);
  }

  return written;
}

function buildContractFallbackFrameHtml(input: {
  contract: QivanceFrameContract;
  title: string;
  imagePath?: string;
}): string {
  const metadata = JSON.stringify({
    graphNodeId: input.contract.graphNodeId,
    sceneId: input.contract.sceneId,
    durationSec: input.contract.durationSec,
    durationPolicy: "strict",
  });
  const image = input.imagePath
    ? `<img class="bg" src="${escapeHtml(input.imagePath)}" alt="">`
    : "";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #111; color: #fff; font-family: Inter, Arial, sans-serif; }
    .frame { position: relative; width: 100vw; height: 100vh; display: grid; place-items: center; isolation: isolate; }
    .bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: -2; }
    .shade { position: absolute; inset: 0; background: linear-gradient(135deg, rgba(0,0,0,.68), rgba(0,0,0,.18)); z-index: -1; }
    .panel { width: min(78vw, 980px); padding: 4vw; border-left: 10px solid #27f5c6; }
    .kicker { font-size: 22px; letter-spacing: 0; text-transform: uppercase; opacity: .78; }
    .title { margin-top: 18px; font-size: 72px; line-height: .95; font-weight: 800; letter-spacing: 0; }
    .meta { margin-top: 24px; font-size: 24px; opacity: .8; }
  </style>
</head>
<body>
  <script>window.__QIVANCE_FRAME = ${metadata};</script>
  <main class="frame">
    ${image}
    <div class="shade"></div>
    <section class="panel">
      <div class="kicker">${escapeHtml(input.contract.sceneId)}</div>
      <div class="title">${escapeHtml(input.title)}</div>
      <div class="meta">${input.contract.durationSec.toFixed(2)}s strict frame</div>
    </section>
  </main>
</body>
</html>
`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
