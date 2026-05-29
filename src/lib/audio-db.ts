import { randomUUID, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { ensureDir } from "./fs-utils.ts";

export type SavedAudioAsset = {
  id: string;
  filename: string;
  mimeType: string;
  byteLength: number;
  sha256: string;
  createdAt: string;
};

type AudioAssetRow = {
  id: string;
  filename: string;
  mime_type: string;
  byte_length: number;
  sha256: string;
  data: Uint8Array;
  created_at: string;
};

export async function saveAudioAsset(
  storageRoot: string,
  input: { filename: string; mimeType?: string; data: Buffer },
): Promise<SavedAudioAsset> {
  if (input.data.byteLength === 0) {
    throw new Error("Uploaded audio file is empty.");
  }

  const db = await openAudioDatabase(storageRoot);
  try {
    const id = `audio_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const createdAt = new Date().toISOString();
    const sha256 = createHash("sha256").update(input.data).digest("hex");
    const mimeType = input.mimeType?.trim() || "application/octet-stream";
    db.prepare(
      `INSERT INTO audio_assets (id, filename, mime_type, byte_length, sha256, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.filename, mimeType, input.data.byteLength, sha256, input.data, createdAt);
    return {
      id,
      filename: input.filename,
      mimeType,
      byteLength: input.data.byteLength,
      sha256,
      createdAt,
    };
  } finally {
    db.close();
  }
}

export async function materializeAudioAsset(
  storageRoot: string,
  assetId: string,
  outputDir: string,
  outputBaseName: string,
): Promise<SavedAudioAsset & { path: string; filename: string }> {
  const db = await openAudioDatabase(storageRoot);
  try {
    const row = db.prepare("SELECT * FROM audio_assets WHERE id = ?").get(assetId) as AudioAssetRow | undefined;
    if (!row) {
      throw new Error(`Missing audio asset ${assetId}`);
    }

    await ensureDir(outputDir);
    const filename = `${outputBaseName}${safeAudioExtension(row.filename)}`;
    const outputPath = path.join(outputDir, filename);
    await writeFile(outputPath, Buffer.from(row.data));
    return {
      id: row.id,
      filename,
      mimeType: row.mime_type,
      byteLength: row.byte_length,
      sha256: row.sha256,
      createdAt: row.created_at,
      path: outputPath,
    };
  } finally {
    db.close();
  }
}

async function openAudioDatabase(storageRoot: string): Promise<DatabaseSync> {
  await ensureDir(storageRoot);
  const db = new DatabaseSync(path.join(storageRoot, "qivance_audio.sqlite"));
  db.exec(`CREATE TABLE IF NOT EXISTS audio_assets (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_length INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL
  )`);
  return db;
}

function safeAudioExtension(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  return [".mp3", ".wav", ".m4a", ".aac"].includes(extension) ? extension : ".mp3";
}
