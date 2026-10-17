import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: join(repoRoot, ".env") });

export const pool: pg.Pool | null = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
  : null;
