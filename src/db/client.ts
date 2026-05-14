import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;
export type DatabaseTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface DbHandle {
  db: Database;
  client: postgres.Sql;
}

export function createDatabase(databaseUrl: string): DbHandle {
  const normalized = normalizeDatabaseUrl(databaseUrl);
  const client = postgres(normalized, { max: 10, prepare: false });
  const db = drizzle(client, { schema, casing: "snake_case" });
  return { db, client };
}

export async function closeDatabase(handle: DbHandle): Promise<void> {
  await handle.client.end({ timeout: 5 });
}

// Accept the SQLAlchemy-style "postgresql+asyncpg://" URLs from the old config
// so existing .env files keep working after the rewrite.
function normalizeDatabaseUrl(url: string): string {
  return url
    .replace(/^postgresql\+asyncpg:\/\//, "postgres://")
    .replace(/^postgresql:\/\//, "postgres://");
}
