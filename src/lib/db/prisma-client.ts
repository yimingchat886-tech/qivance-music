import { DatabaseSync } from "node:sqlite";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const migrationsRoot = path.join(repoRoot, "prisma", "migrations");

export type QivancePrismaClient = PrismaClient;

export function resolveControlPlaneDatabasePath(storageRoot: string): string {
  return path.join(path.resolve(storageRoot), "qivance_control.sqlite");
}

export function controlPlaneDatabaseUrl(storageRoot: string): string {
  return `file:${resolveControlPlaneDatabasePath(storageRoot)}`;
}

export async function ensureControlPlaneDatabase(storageRoot: string): Promise<void> {
  await mkdir(path.resolve(storageRoot), { recursive: true });
  const db = new DatabaseSync(resolveControlPlaneDatabasePath(storageRoot));
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(`CREATE TABLE IF NOT EXISTS "_qivance_migrations" (
      "name" TEXT NOT NULL PRIMARY KEY,
      "applied_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

    const migrationDirs = (await readdir(migrationsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const migrationName of migrationDirs) {
      const applied = db.prepare(`SELECT name FROM "_qivance_migrations" WHERE name = ?`).get(migrationName);
      if (applied) continue;
      const sql = await readFile(path.join(migrationsRoot, migrationName, "migration.sql"), "utf8");
      db.exec("BEGIN");
      try {
        db.exec(sql);
        db.prepare(`INSERT INTO "_qivance_migrations" ("name") VALUES (?)`).run(migrationName);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  } finally {
    db.close();
  }
}

export async function createQivancePrismaClient(storageRoot: string): Promise<QivancePrismaClient> {
  await ensureControlPlaneDatabase(storageRoot);
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      url: controlPlaneDatabaseUrl(storageRoot),
    }),
  });
}

export async function closeQivancePrismaClient(prisma: QivancePrismaClient): Promise<void> {
  await prisma.$disconnect();
}
