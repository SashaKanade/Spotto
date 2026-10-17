import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: join(repoRoot, ".env") });

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
  process.exit(1);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const applied = new Set(
      (
        await client.query<{ filename: string }>(
          "SELECT filename FROM schema_migrations ORDER BY filename",
        )
      ).rows.map((r) => r.filename),
    );

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip ${file} (already applied)`);
        continue;
      }

      const sql = readFileSync(join(migrationsDir, file), "utf8");
      console.log(`apply ${file}...`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1)",
          [file],
        );
        await client.query("COMMIT");
        console.log(`done ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
