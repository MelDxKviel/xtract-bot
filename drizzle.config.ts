import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  // drizzle-kit needs the URL only for `push`/`migrate`; tolerate absence so
  // `generate` works in CI without env wiring.

  console.warn("DATABASE_URL is not set; drizzle-kit commands that hit the database will fail.");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: {
    url: databaseUrl ?? "postgres://placeholder/placeholder",
  },
});
