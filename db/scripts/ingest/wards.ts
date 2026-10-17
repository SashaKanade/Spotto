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

export async function ingestWards(client: pg.PoolClient): Promise<number> {
  const pkg = await packageShow(PACKAGES.wards);
  const resource = pickDatastoreResource(pkg.resources);
  const fields = await datastoreFields(resource.id);

  const firstBatch = (await datastoreRecords(resource.id, { pageSize: 3 }).next()).value ?? [];
  printColumnSummary(`Wards (${pkg.title})`, fields, firstBatch);

  await client.query(`TRUNCATE wards RESTART IDENTITY CASCADE`);

  let inserted = 0;
  for await (const batch of datastoreRecords(resource.id)) {
    for (const row of batch) {
      if (row.AREA_TYPE !== "CITW") continue;
      const geomJson = geometryGeoJson(row);
      if (!geomJson) continue;

      const wardNumber = Number.parseInt(String(row.AREA_SHORT_CODE), 10);
      if (Number.isNaN(wardNumber)) continue;

      await client.query(
        `
        INSERT INTO wards (area_id, ward_number, name, geometry, source_objectid)
        VALUES (
          $1, $2, $3,
          ST_Multi(ST_CollectionExtract(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326), 3)),
          $5
        )
        `,
        [
          row.AREA_ID,
          wardNumber,
          row.AREA_NAME,
          geomJson,
          row.OBJECTID ?? null,
        ],
      );
      inserted += 1;
    }
  }

  const sourceUrl = resourceSourceUrl(resource, PACKAGES.wards);
  await writeIngestLog(client, "wards", sourceUrl, inserted);
  console.log(`Wards: loaded ${inserted} rows.`);
  return inserted;
}
