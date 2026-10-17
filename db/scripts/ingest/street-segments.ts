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
    for (const row of batch) {
      const geomJson = geometryGeoJson(row);
      if (!geomJson) continue;

      await client.query(
        `
        INSERT INTO street_segments (
          centreline_id, linear_name_full, feature_code, feature_code_desc,
          oneway_dir_code_desc, jurisdiction, centreline_status, length_m,
          geometry, source_objectid
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          ST_Length(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($8), 4326), 3857)),
          ST_LineMerge(ST_SetSRID(ST_GeomFromGeoJSON($8), 4326)),
          $9
        )
        ON CONFLICT (centreline_id) DO NOTHING
        `,
        [
          row.CENTRELINE_ID,
          row.LINEAR_NAME_FULL,
          row.FEATURE_CODE,
          row.FEATURE_CODE_DESC,
          row.ONEWAY_DIR_CODE_DESC,
          row.JURISDICTION,
          row.CENTRELINE_STATUS,
          geomJson,
          row.OBJECTID ?? null,
        ],
      );
      inserted += 1;
    }
    process.stdout.write(`\rCentreline: ${inserted} rows…`);
  }
  console.log("");

  const sourceUrl = resourceSourceUrl(resource, PACKAGES.centreline);
  await writeIngestLog(client, "street_segments", sourceUrl, inserted);
  console.log(`Street segments: loaded ${inserted} rows.`);
  return inserted;
}
