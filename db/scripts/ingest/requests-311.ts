import { createHash } from "node:crypto";
import type pg from "pg";
import { parse } from "csv-parse";
import unzipper from "unzipper";
import {
  packageShow,
  pick311YearResources,
  resourceSourceUrl,
} from "../lib/ckan.js";
import { PACKAGES, REQUESTS_311_YEARS } from "../lib/config.js";
import { parseWardNumberFrom311 } from "../lib/geo.js";
import { writeIngestLog } from "../lib/ingest-log.js";
import { csvHeaderSummary } from "../lib/inspect.js";
import {
  assign311WardIdsByNumber,
  assignWardIdsFromGeometry,
  geocode311Intersections,
} from "../lib/spatial.js";

const BIKE_REQUEST_PATTERN =
  /(bike lane|bicycle|\bcycling\b|\bbike\b|bikeway|abandoned bikes?|bike removal inquiry)/i;
const EXCLUDE_PATTERN = /recycle/i;

function isBikeRelatedRequestType(type: string): boolean {
  if (EXCLUDE_PATTERN.test(type)) return false;
  return BIKE_REQUEST_PATTERN.test(type);
}

function externalId(year: number, row: Record<string, string>): string {
  const payload = [
    year,
    row["Creation Date"],
    row["Service Request Type"],
    row.Ward,
    row["Intersection Street 1"],
    row["Intersection Street 2"],
    row["First 3 Chars of Postal Code"],
  ].join("|");
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

async function parse311Zip(url: string): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download 311 ZIP: ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const directory = await unzipper.Open.buffer(buf);
  const csvEntry = directory.files.find((f) => f.path.toLowerCase().endsWith(".csv"));
  if (!csvEntry) throw new Error(`No CSV inside 311 ZIP from ${url}`);

  const rows: Record<string, string>[] = [];
  let headers: string[] = [];

  await new Promise<void>((resolve, reject) => {
    csvEntry
      .stream()
      .pipe(parse({ columns: true, trim: true, relax_column_count: true }))
      .on("headers", (h: string[]) => {
        headers = h;
      })
      .on("data", (row: Record<string, string>) => rows.push(row))
      .on("end", () => resolve())
      .on("error", reject);
  });

  return { headers, rows };
}

export async function ingestRequests311(client: pg.PoolClient): Promise<number> {
  const pkg = await packageShow(PACKAGES.requests311);
  const yearResources = pick311YearResources(pkg.resources, REQUESTS_311_YEARS);

  let totalInserted = 0;
  await client.query(`TRUNCATE requests_311 RESTART IDENTITY CASCADE`);

  for (const resource of yearResources) {
    const yearMatch = resource.name.match(/(20\d{2})/);
    const year = yearMatch ? Number.parseInt(yearMatch[1], 10) : NaN;
    if (Number.isNaN(year)) throw new Error(`Could not parse year from ${resource.name}`);

    console.log(`\nDownloading ${resource.name}…`);
    const { headers, rows } = await parse311Zip(resource.url);
    if (headers.length > 0) {
      csvHeaderSummary(`311 Service Requests ${year}`, headers);
    }

    const bikeRows = rows.filter((r) =>
      isBikeRelatedRequestType(r["Service Request Type"] ?? ""),
    );
    console.log(
      `311 ${year}: ${rows.length} total rows → ${bikeRows.length} bike-related (after filters).`,
    );

    let inserted = 0;
    for (const row of bikeRows) {
      const openedRaw = row["Creation Date"];
      if (!openedRaw) continue;
      const openedAt = new Date(openedRaw);
      if (Number.isNaN(openedAt.getTime())) continue;

      const wardNum = parseWardNumberFrom311(row.Ward);
      let wardId: number | null = null;
      if (wardNum != null) {
        const w = await client.query<{ id: number }>(
          `SELECT id FROM wards WHERE ward_number = $1`,
          [wardNum],
        );
        wardId = w.rows[0]?.id ?? null;
      }

      await client.query(
        `
        INSERT INTO requests_311 (
          external_id, request_type, status, opened_at, closed_at,
          ward_name, ward_id, intersection_street_1, intersection_street_2,
          postal_prefix, division, section, source_year
        )
        VALUES ($1, $2, $3, $4::timestamptz, NULL, $5, $6, $7, $8, $9, $10, $11, $12)
        `,
        [
          externalId(year, row),
          row["Service Request Type"],
          row.Status ?? null,
          openedAt.toISOString(),
          row.Ward ?? null,
          wardId,
          row["Intersection Street 1"] || null,
          row["Intersection Street 2"] || null,
          row["First 3 Chars of Postal Code"] || null,
          row.Division ?? null,
          (row.Section ?? "").replace(/\r$/, "") || null,
          year,
        ],
      );
      inserted += 1;
    }

    const sourceUrl = resourceSourceUrl(resource, PACKAGES.requests311);
    await writeIngestLog(client, `requests_311_${year}`, sourceUrl, inserted);
    console.log(`311 ${year}: inserted ${inserted} rows.`);
    totalInserted += inserted;
  }

  const geocoded = await geocode311Intersections(client);
  const byName = await assign311WardIdsByNumber(client);
  const byGeom = await assignWardIdsFromGeometry(client, "requests_311", "geometry");
  console.log(
    `311: geocoded ${geocoded} intersection points; ward_id by name ${byName}; ward_id by geometry ${byGeom}.`,
  );

  return totalInserted;
}
