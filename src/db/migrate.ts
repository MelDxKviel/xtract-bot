#!/usr/bin/env bun
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";

const MIGRATIONS_DIR = path.resolve(import.meta.dir, "../../drizzle/migrations");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const normalized = url
    .replace(/^postgresql\+asyncpg:\/\//, "postgres://")
    .replace(/^postgresql:\/\//, "postgres://");
  const sql = postgres(normalized, { max: 1, prepare: false });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS xtract_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith(".sql")).sort();

    for (const file of files) {
      const existing = await sql<{ name: string }[]>`
        SELECT name FROM xtract_migrations WHERE name = ${file}
      `;
      if (existing.length > 0) {
        console.log(`✓ ${file} already applied`);
        continue;
      }
      const body = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      console.log(`→ applying ${file}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO xtract_migrations (name) VALUES (${file})`;
      });
      console.log(`✓ applied ${file}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
