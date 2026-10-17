import type pg from "pg";
import {
  datastoreFields,
  datastoreRecords,
  packageShow,
  pickDatastoreResource,
  resourceSourceUrl,
} from "../lib/ckan.js";
import { PACKAGES } from "../lib/config.js";
import { geometryGeoJson } from "../lib/geo.js";
import { writeIngestLog } from "../lib/ingest-log.js";
import { printColumnSummary } from "../lib/inspect.js";

export async function ingestStreetSegments(client: pg.PoolClient): Promise<number> {
  const pkg = await packageShow(PACKAGES.centreline);
  const resource = pickDatastoreResource(pkg.resources);
  const fields = await datastoreFields(resource.id);

  const firstBatch = (await datastoreRecords(resource.id, { pageSize: 2 }).next()).value ?? [];
  printColumnSummary(`Toronto Centreline (${pkg.title})`, fields, firstBatch);

  await client.query(`TRUNCATE street_segments RESTART IDENTITY CASCADE`);

  let inserted = 0;
  for await (const batch of datastoreRecords(resource.id, { pageSize: 3000 })) {
    const rows = batch.flatMap((row) => {
      const geometry = geometryGeoJson(row);
      return geometry ? [{ ...row, geometry }] : [];
    });
    if (rows.length === 0) continue;
    const result = await client.query(
      `
      WITH source AS (
        SELECT row->>'CENTRELINE_ID' AS centreline_id,
               NULLIF(row->>'LINEAR_NAME_FULL', 'null') AS linear_name_full,
               NULLIF(row->>'FEATURE_CODE', 'null') AS feature_code,
               NULLIF(row->>'FEATURE_CODE_DESC', 'null') AS feature_code_desc,
               NULLIF(row->>'ONEWAY_DIR_CODE_DESC', 'null') AS oneway_dir_code_desc,
               NULLIF(row->>'JURISDICTION', 'null') AS jurisdiction,
               NULLIF(row->>'CENTRELINE_STATUS', 'null') AS centreline_status,
               NULLIF(row->>'OBJECTID', 'null') AS source_objectid,
               ST_LineMerge(ST_SetSRID(ST_GeomFromGeoJSON(row->>'geometry'), 4326)) AS geom
        FROM jsonb_array_elements($1::jsonb) AS x(row)
      )
      INSERT INTO street_segments (
        centreline_id, linear_name_full, feature_code, feature_code_desc,
        oneway_dir_code_desc, jurisdiction, centreline_status, length_m,
        geometry, source_objectid
      )
      SELECT centreline_id::bigint, linear_name_full, feature_code, feature_code_desc,
             oneway_dir_code_desc, jurisdiction, centreline_status,
             ST_Length(ST_Transform(geom, 3857)), geom, source_objectid::bigint
      FROM source
      ON CONFLICT (centreline_id) DO NOTHING
      `,
      [JSON.stringify(rows)],
    );
    inserted += result.rowCount ?? 0;
    process.stdout.write(`\rCentreline: ${inserted} rows…`);
  }
  console.log("");

  const sourceUrl = resourceSourceUrl(resource, PACKAGES.centreline);
  await writeIngestLog(client, "street_segments", sourceUrl, inserted);
  console.log(`Street segments: loaded ${inserted} rows.`);
  return inserted;
}
