import type pg from "pg";

export async function writeIngestLog(
  client: pg.PoolClient,
  datasetName: string,
  sourceUrl: string,
  rowCount: number,
): Promise<void> {
  await client.query(
    `INSERT INTO ingest_log (dataset_name, source_url, row_count) VALUES ($1, $2, $3)`,
    [datasetName, sourceUrl, rowCount],
  );
}
