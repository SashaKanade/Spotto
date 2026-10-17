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
  for await (const batch of datastoreRecords(resource.id, { pageSize: 3000 })) {
    const rows = batch.flatMap((row) => {
      const geometry = geometryGeoJson(row);
      if (!geometry) return [];
      const geomJson = geometryGeoJson(row);
      const infraHigh = String(row.INFRA_HIGHORDER ?? "");
      if (infraHigh) infraValues.add(infraHigh);
      return [{ segment_id: row.SEGMENT_ID ?? null, street_name: row.STREET_NAME ?? null,
        from_street: row.FROM_STREET ?? null, to_street: row.TO_STREET ?? null,
        infra_highorder: infraHigh, infra_loworder: row.INFRA_LOWORDER ?? null,
        protection_level: protectionFromInfraHigh(infraHigh),
        installed_year: parseYear(row.INSTALLED), upgraded_year: parseYear(row.UPGRADED),
        geometry: geomJson }];
    });
    if (rows.length === 0) continue;
    const result = await client.query(
      `WITH source AS (
         SELECT row->>'segment_id' AS segment_id,
                NULLIF(row->>'street_name','null') AS street_name,
                NULLIF(row->>'from_street','null') AS from_street,
                NULLIF(row->>'to_street','null') AS to_street,
                row->>'infra_highorder' AS infra_highorder,
                NULLIF(row->>'infra_loworder','null') AS infra_loworder,
                row->>'protection_level' AS protection_level,
                NULLIF(row->>'installed_year','null') AS installed_year,
                NULLIF(row->>'upgraded_year','null') AS upgraded_year,
                ST_Multi(ST_LineMerge(ST_SetSRID(ST_GeomFromGeoJSON(row->>'geometry'),4326))) AS geom
         FROM jsonb_array_elements($1::jsonb) AS x(row)
       )
       INSERT INTO bike_infrastructure (
         segment_id,street_name,from_street,to_street,infra_highorder,infra_loworder,
         protection_level,installed_year,upgraded_year,shape_length_m,geometry
       )
       SELECT segment_id,street_name,from_street,to_street,infra_highorder,infra_loworder,
              protection_level::protection_level,installed_year::smallint,upgraded_year::smallint,
              ST_Length(ST_Transform(geom,3857)),geom FROM source`,
      [JSON.stringify(rows)],
    );
    inserted += result.rowCount ?? 0;
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
