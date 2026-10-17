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
import { protectionFromInfraHigh } from "../lib/protection.js";
import { snapBikeInfraToNearestSegment } from "../lib/spatial.js";

function parseYear(v: unknown): number | null {
  if (v == null || v === "None") return null;
  const n = Number.parseInt(String(v), 10);
  return Number.isNaN(n) ? null : n;
}

export async function ingestBikeInfrastructure(client: pg.PoolClient): Promise<number> {
  const pkg = await packageShow(PACKAGES.cyclingNetwork);
  const resource = pickDatastoreResource(pkg.resources);
  const fields = await datastoreFields(resource.id);

  const firstBatch = (await datastoreRecords(resource.id, { pageSize: 2 }).next()).value ?? [];
  printColumnSummary(`Cycling Network (${pkg.title})`, fields, firstBatch);

  await client.query(`TRUNCATE bike_infrastructure RESTART IDENTITY CASCADE`);

  const infraValues = new Set<string>();
  let inserted = 0;
  for await (const batch of datastoreRecords(resource.id)) {
    for (const row of batch) {
      const geomJson = geometryGeoJson(row);
      if (!geomJson) continue;
      const infraHigh = String(row.INFRA_HIGHORDER ?? "");
      if (infraHigh) infraValues.add(infraHigh);
      const protection = protectionFromInfraHigh(infraHigh);

      await client.query(
        `
        INSERT INTO bike_infrastructure (
          segment_id, street_name, from_street, to_street,
          infra_highorder, infra_loworder, protection_level,
          installed_year, upgraded_year, shape_length_m, geometry
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7::protection_level, $8, $9,
          ST_Length(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($10), 4326), 3857)),
          ST_Multi(ST_LineMerge(ST_SetSRID(ST_GeomFromGeoJSON($10), 4326)))
        )
        `,
        [
          row.SEGMENT_ID ?? null,
          row.STREET_NAME ?? null,
          row.FROM_STREET ?? null,
          row.TO_STREET ?? null,
          infraHigh,
          row.INFRA_LOWORDER ?? null,
          protection,
          parseYear(row.INSTALLED),
          parseYear(row.UPGRADED),
          geomJson,
        ],
      );
      inserted += 1;
    }
  }

  console.log("\nINFRA_HIGHORDER values → protection_level mapping:");
  console.table(
    [...infraValues].sort().map((v) => ({
      INFRA_HIGHORDER: v,
      protection_level: protectionFromInfraHigh(v),
    })),
  );

  const snapped = await snapBikeInfraToNearestSegment(client);
  console.log(`Bike infrastructure: snapped ${snapped} rows to nearest street segment.`);

  const sourceUrl = resourceSourceUrl(resource, PACKAGES.cyclingNetwork);
  await writeIngestLog(client, "bike_infrastructure", sourceUrl, inserted);
  console.log(`Bike infrastructure: loaded ${inserted} rows.`);
  return inserted;
}
