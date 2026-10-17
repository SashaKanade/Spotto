import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: join(repoRoot, ".env") });

export function getPool(): pg.Pool {
  const { DATABASE_URL } = process.env;
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  }
  return new pg.Pool({ connectionString: DATABASE_URL });
}

export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
