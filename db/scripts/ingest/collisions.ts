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
import {
  assignWardIdsFromGeometry,
  snapPointsToNearestSegment,
} from "../lib/spatial.js";

function parseAccidentDate(accdate: unknown): { occurredOn: string; year: number } | null {
  if (!accdate) return null;
  const d = new Date(String(accdate));
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString().slice(0, 10);
  return { occurredOn: iso, year: d.getUTCFullYear() };
}

export async function ingestCollisions(client: pg.PoolClient): Promise<number> {
  const pkg = await packageShow(PACKAGES.ksiCollisions);
  const resource = pickDatastoreResource(pkg.resources);
  const fields = await datastoreFields(resource.id);

  const filter = { road_user: "cyclist" };
  const firstBatch =
    (await datastoreRecords(resource.id, { pageSize: 3, filters: filter }).next()).value ?? [];
  printColumnSummary(
    `Cyclist KSI collisions (${pkg.title}, road_user=cyclist)`,
    fields,
    firstBatch,
  );

  await client.query(`TRUNCATE collisions RESTART IDENTITY CASCADE`);

  let inserted = 0;
  let skipped = 0;
  for await (const batch of datastoreRecords(resource.id, {
    pageSize: 2000,
    filters: filter,
  })) {
    for (const row of batch) {
      const geomJson = geometryGeoJson(row);
      const parsed = parseAccidentDate(row.accdate);
      if (!geomJson || !parsed) {
        skipped += 1;
        continue;
      }

      await client.query(
        `
        INSERT INTO collisions (
          collision_id, occurred_on, year, injury, stname1, stname2, ward_name,
          longitude, latitude, location, source_per_no
        )
        VALUES (
          $1, $2::date, $3, $4, $5, $6, $7, $8, $9,
          ST_SetSRID(ST_GeomFromGeoJSON($10), 4326),
          $11
        )
        ON CONFLICT (collision_id, source_per_no) DO NOTHING
        `,
        [
          String(row.collision_id),
          parsed.occurredOn,
          parsed.year,
          row.injury ?? null,
          row.stname1 ?? null,
          row.stname2 ?? null,
          row.wardname ?? null,
          row.longitude ?? null,
          row.latitude ?? null,
          geomJson,
          row.per_no ?? null,
        ],
      );
      inserted += 1;
    }
    process.stdout.write(`\rCollisions: ${inserted} rows…`);
  }
  console.log("");

  const wardsUpdated = await assignWardIdsFromGeometry(client, "collisions", "location");
  const snapped = await snapPointsToNearestSegment(client, "collisions", "location");
  console.log(
    `Collisions: spatial ward_id on ${wardsUpdated} rows; nearest segment on ${snapped} rows; skipped ${skipped} (missing geom/date).`,
  );

  const sourceUrl = resourceSourceUrl(resource, PACKAGES.ksiCollisions);
  await writeIngestLog(client, "collisions", sourceUrl, inserted);
  console.log(`Collisions: loaded ${inserted} cyclist KSI rows.`);
  return inserted;
}
