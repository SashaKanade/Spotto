import { Router } from "express";
import { z } from "zod";
import { cached, ONE_HOUR } from "../cache.js";
import { HttpError, parse, route } from "../http.js";
import { pool } from "../db.js";

export const geocodeRouter = Router();

const searchSchema = z.object({
  q: z.string().trim().min(3).max(120),
});

interface NominatimResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
}

interface SearchResult {
  id: number | string;
  lat: number;
  lng: number;
  label: string;
}

function intersectionTerms(query: string): [string, string] | null {
  const parts = query
    .replace(/,?\s*(?:toronto|ontario|canada)\s*$/i, "")
    .split(/\s+(?:and|at)\s+|\s*&\s*|\s*\/\s*|\s*@\s*/i);
  if (parts.length !== 2) return null;
  const normalize = (part: string) => part
    .toLocaleLowerCase("en-CA")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^\s*(?:(?:intersection|corner)\s+(?:of\s+)?)?/, "")
    .replace(/\b(?:street)\b/g, "st")
    .replace(/\b(?:avenue)\b/g, "ave")
    .replace(/\b(?:road)\b/g, "rd")
    .replace(/\b(?:boulevard)\b/g, "blvd")
    .replace(/\b(?:west)\b/g, "w")
    .replace(/\b(?:east)\b/g, "e")
    .replace(/\b(?:north)\b/g, "n")
    .replace(/\b(?:south)\b/g, "s")
    .replace(/\bqueens\b/g, "queen")
    .replace(/[^a-z0-9]/g, "");
  const [first, second] = parts.map(normalize);
  return first.length >= 3 && second.length >= 3 ? [first, second] : null;
}

async function findLocalIntersections(query: string): Promise<SearchResult[]> {
  if (!pool) return [];
  const terms = intersectionTerms(query);
  if (!terms) return [];
  const { rows } = await pool.query<{
    street_1: string;
    street_2: string;
    lat: number;
    lng: number;
    id: string;
  }>(
    `
    WITH first_names AS MATERIALIZED (
      SELECT linear_name_full, normalized
      FROM (
        SELECT DISTINCT linear_name_full,
          regexp_replace(regexp_replace(lower(linear_name_full), 'queens', 'queen', 'g'), '[^a-z0-9]+', '', 'g') AS normalized
        FROM street_segments
        WHERE linear_name_full IS NOT NULL
          AND regexp_replace(regexp_replace(lower(linear_name_full), 'queens', 'queen', 'g'), '[^a-z0-9]+', '', 'g') LIKE '%' || $1 || '%'
      ) matched
      ORDER BY abs(length(normalized) - length($1)), linear_name_full
      LIMIT 10
    ), second_names AS MATERIALIZED (
      SELECT linear_name_full, normalized
      FROM (
        SELECT DISTINCT linear_name_full,
          regexp_replace(regexp_replace(lower(linear_name_full), 'queens', 'queen', 'g'), '[^a-z0-9]+', '', 'g') AS normalized
        FROM street_segments
        WHERE linear_name_full IS NOT NULL
          AND regexp_replace(regexp_replace(lower(linear_name_full), 'queens', 'queen', 'g'), '[^a-z0-9]+', '', 'g') LIKE '%' || $2 || '%'
      ) matched
      ORDER BY abs(length(normalized) - length($2)), linear_name_full
      LIMIT 10
    ), first_street AS MATERIALIZED (
      SELECT seg.id, seg.linear_name_full, seg.geometry FROM street_segments seg JOIN first_names names USING (linear_name_full)
    ), second_street AS MATERIALIZED (
      SELECT seg.id, seg.linear_name_full, seg.geometry FROM street_segments seg JOIN second_names names USING (linear_name_full)
    ), crossings AS (
      SELECT DISTINCT ON (
        a.linear_name_full, b.linear_name_full,
        round(ST_X(crossing.point)::numeric, 5), round(ST_Y(crossing.point)::numeric, 5)
      )
        a.linear_name_full AS street_1,
        b.linear_name_full AS street_2,
        crossing.point AS point,
        a.id AS first_id,
        b.id AS second_id
      FROM first_street a
      JOIN second_street b ON a.id <> b.id
        AND a.linear_name_full <> b.linear_name_full
        AND a.geometry && b.geometry
        AND ST_Intersects(a.geometry, b.geometry)
      CROSS JOIN LATERAL (
        SELECT ST_PointOnSurface(ST_Intersection(a.geometry, b.geometry)) AS point
      ) crossing
      WHERE ST_Dimension(ST_Intersection(a.geometry, b.geometry)) = 0
      ORDER BY
        a.linear_name_full, b.linear_name_full,
        round(ST_X(crossing.point)::numeric, 5), round(ST_Y(crossing.point)::numeric, 5), a.id, b.id
    )
    SELECT street_1, street_2,
      ST_Y(point)::float8 AS lat,
      ST_X(point)::float8 AS lng,
      first_id::text || ':' || second_id::text AS id
    FROM crossings
    ORDER BY ST_Distance(
      point::geography,
      ST_SetSRID(ST_MakePoint(-79.3832, 43.6532), 4326)::geography
    )
    LIMIT 5
    `,
    terms,
  );
  return rows.map((row) => ({
    id: `intersection:${row.id}`,
    lat: row.lat,
    lng: row.lng,
    label: `${row.street_1} & ${row.street_2}`,
  }));
}

// Nominatim's public service allows at most one request per second per app.
let nextRequestAt = 0;

async function waitForNominatimSlot(): Promise<void> {
  const now = Date.now();
  const requestAt = Math.max(now, nextRequestAt);
  nextRequestAt = requestAt + 1000;
  const delay = requestAt - now;
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}

geocodeRouter.get(
  "/",
  route(async (req, res) => {
    const { q } = parse(searchSchema, req.query);
    const cacheKey = q.toLocaleLowerCase("en-CA").replace(/\s+/g, " ");
    const results = await cached<SearchResult[]>(`geocode:${cacheKey}`, ONE_HOUR, async () => {
      let localIntersections: SearchResult[] = [];
      try {
        localIntersections = await findLocalIntersections(q);
      } catch (error) {
        // The external address search remains available if local street geometry is unavailable.
        console.warn("Local intersection lookup failed; falling back to Nominatim.", error);
      }
      if (localIntersections.length > 0) return localIntersections;

      await waitForNominatimSlot();
      const endpoint = process.env.NOMINATIM_SEARCH_URL ?? "https://nominatim.openstreetmap.org/search";
      const url = new URL(endpoint);
      url.search = new URLSearchParams({
        q: `${q}, Toronto, Ontario, Canada`,
        format: "jsonv2",
        limit: "5",
        countrycodes: "ca",
        viewbox: "-79.9,44.0,-78.9,43.3",
        bounded: "1",
      }).toString();

      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            Accept: "application/json",
            "Accept-Language": "en-CA,en;q=0.8",
            "User-Agent": "Spotto/1.0 (Toronto cyclist safety map)",
          },
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        throw new HttpError(503, "Place search is temporarily unavailable. Please try again.");
      }
      if (!response.ok) {
        throw new HttpError(503, "Place search is temporarily unavailable. Please try again.");
      }

      const places = (await response.json()) as NominatimResult[];
      return places.flatMap((place) => {
        const lat = Number(place.lat);
        const lng = Number(place.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !place.display_name) return [];
        return [{ id: place.place_id, lat, lng, label: place.display_name }];
      });
    });

    res.json({ results, attribution: "© OpenStreetMap contributors" });
  }),
);
