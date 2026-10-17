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
  let res: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      res = await fetch(url);
      if (res.ok) break;
      if (![429, 502, 503, 504].includes(res.status)) break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  if (!res?.ok) throw new Error(`Failed to download 311 ZIP after retries: ${res?.status ?? "network error"} ${url}`);
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
  let loadedYears = 0;
  await client.query(`TRUNCATE requests_311 RESTART IDENTITY CASCADE`);
  const wardRows = await client.query<{ id: number; ward_number: number }>(
    `SELECT id, ward_number FROM wards`,
  );
  const wardIds = new Map(wardRows.rows.map((w) => [w.ward_number, w.id]));

  for (const resource of yearResources) {
    const yearMatch = resource.name.match(/(20\d{2})/);
    const year = yearMatch ? Number.parseInt(yearMatch[1], 10) : NaN;
    if (Number.isNaN(year)) throw new Error(`Could not parse year from ${resource.name}`);

    console.log(`\nDownloading ${resource.name}…`);
    let parsed: { headers: string[]; rows: Record<string, string>[] };
    try {
      parsed = await parse311Zip(resource.url);
    } catch (error) {
      console.warn(`311 ${year}: resource unavailable; skipping this year. ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const { headers, rows } = parsed;
    loadedYears += 1;
    if (headers.length > 0) {
      csvHeaderSummary(`311 Service Requests ${year}`, headers);
    }

    const bikeRows = rows.filter((r) =>
      isBikeRelatedRequestType(r["Service Request Type"] ?? ""),
    );
    console.log(
      `311 ${year}: ${rows.length} total rows → ${bikeRows.length} bike-related (after filters).`,
    );

    const insertRows: Record<string, unknown>[] = [];
    for (const row of bikeRows) {
      const openedRaw = row["Creation Date"];
      if (!openedRaw) continue;
      const openedAt = new Date(openedRaw);
      if (Number.isNaN(openedAt.getTime())) continue;

      const wardNum = parseWardNumberFrom311(row.Ward);
      insertRows.push({
        external_id: externalId(year, row),
        request_type: row["Service Request Type"],
        status: row.Status ?? null,
        opened_at: openedAt.toISOString(),
        ward_name: row.Ward ?? null,
        ward_id: wardNum == null ? null : wardIds.get(wardNum) ?? null,
        intersection_street_1: row["Intersection Street 1"] || null,
        intersection_street_2: row["Intersection Street 2"] || null,
        postal_prefix: row["First 3 Chars of Postal Code"] || null,
        division: row.Division ?? null,
        section: (row.Section ?? row["Section\r"] ?? "").replace(/\r$/, "") || null,
        source_year: year,
      });
    }

    const batchSize = 1000;
    for (let i = 0; i < insertRows.length; i += batchSize) {
      const chunk = insertRows.slice(i, i + batchSize);
      await client.query(
        `INSERT INTO requests_311 (
           external_id,request_type,status,opened_at,closed_at,ward_name,ward_id,
           intersection_street_1,intersection_street_2,postal_prefix,division,section,source_year
         )
         SELECT external_id,request_type,status,opened_at::timestamptz,NULL,ward_name,ward_id::int,
                intersection_street_1,intersection_street_2,postal_prefix,division,section,source_year::smallint
         FROM jsonb_to_recordset($1::jsonb) AS x(
           external_id text,request_type text,status text,opened_at text,ward_name text,ward_id text,
           intersection_street_1 text,intersection_street_2 text,postal_prefix text,division text,
           section text,source_year text
         )`,
        [JSON.stringify(chunk)],
      );
    }
    const inserted = insertRows.length;

    const sourceUrl = resourceSourceUrl(resource, PACKAGES.requests311);
    await writeIngestLog(client, `requests_311_${year}`, sourceUrl, inserted);
    console.log(`311 ${year}: inserted ${inserted} rows.`);
    totalInserted += inserted;
  }

  if (loadedYears === 0) throw new Error("No recent 311 annual files could be downloaded; existing table refresh rolled back.");

  const geocoded = await geocode311Intersections(client);
  const byName = await assign311WardIdsByNumber(client);
  const byGeom = await assignWardIdsFromGeometry(client, "requests_311", "geometry");
  console.log(
    `311: geocoded ${geocoded} intersection points; ward_id by name ${byName}; ward_id by geometry ${byGeom}.`,
  );

  return totalInserted;
}
