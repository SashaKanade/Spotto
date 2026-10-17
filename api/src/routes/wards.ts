import { Router } from "express";
import { z } from "zod";
import { cached, FIVE_MINUTES } from "../cache.js";
import {
  featureCollection,
  HttpError,
  parse,
  requirePool,
  route,
  wardNumberSchema,
  type GeoJsonFeature,
} from "../http.js";

export const wardsRouter = Router();

interface WardSummaryRow {
  ward_number: number;
  name: string;
  ksi_total: number;
  km_protected: number;
  geometry: unknown;
}

/**
 * GET /api/wards
 * All 25 wards as a GeoJSON FeatureCollection (simplified boundaries for display)
 * with headline counts. Descriptive statistics only.
 */
wardsRouter.get(
  "/",
  route(async (_req, res) => {
    const pool = requirePool();

    const rows = await cached("wards:list", FIVE_MINUTES, async () => {
      const result = await pool.query<WardSummaryRow>(
        `
        SELECT
          w.ward_number,
          w.name,
          COALESCE(c.ksi_total, 0)::int AS ksi_total,
          COALESCE(l.km_protected, 0)::float8 AS km_protected,
          ST_AsGeoJSON(ST_SimplifyPreserveTopology(w.geometry, 0.0002), 5)::json AS geometry
        FROM wards w
        LEFT JOIN (
          SELECT ward_id, COUNT(*) AS ksi_total FROM collisions GROUP BY ward_id
        ) c ON c.ward_id = w.id
        LEFT JOIN LATERAL (
          SELECT SUM(
            ST_Length(ST_CollectionExtract(ST_Intersection(b.geometry, w.geometry), 2)::geography)
          ) / 1000.0 AS km_protected
          FROM bike_infrastructure b
          WHERE b.protection_level = 'protected'
            AND b.geometry && w.geometry
            AND ST_Intersects(b.geometry, w.geometry)
        ) l ON true
        ORDER BY w.ward_number
        `,
      );
      return result.rows;
    });

    const features: GeoJsonFeature[] = rows.map(({ geometry, ...properties }) => ({
      type: "Feature",
      geometry,
      properties,
    }));
    res.json(featureCollection(features, { count: features.length }));
  }),
);

const paramsSchema = z.object({ ward: wardNumberSchema });

interface WardRow {
  id: number;
  ward_number: number;
  name: string;
  bbox: [number, number, number, number];
}

/**
 * GET /api/wards/:ward   (ward = ward number, 1-25)
 * Descriptive stats for one ward: cyclist KSI by year, km of bike lanes by protection
 * level, share of the ward's KSI collisions within 100 m of a protected lane, and
 * 311 bike-related request counts.
 */
wardsRouter.get(
  "/:ward",
  route(async (req, res) => {
    const { ward } = parse(paramsSchema, req.params);
    const pool = requirePool();

    const body = await cached(`wards:detail:${ward}`, FIVE_MINUTES, async () => {
      const wardResult = await pool.query<WardRow>(
        `
        SELECT id, ward_number, name,
               ARRAY[ST_XMin(geometry), ST_YMin(geometry), ST_XMax(geometry), ST_YMax(geometry)]::float8[] AS bbox
        FROM wards WHERE ward_number = $1
        `,
        [ward],
      );
      const w = wardResult.rows[0];
      if (!w) return null;

      const [byYear, lanes, near, requests] = await Promise.all([
        pool.query<{ year: number; count: number }>(
          `
          SELECT year::int AS year, COUNT(*)::int AS count
          FROM collisions WHERE ward_id = $1
          GROUP BY year ORDER BY year
          `,
          [w.id],
        ),
        pool.query<{ protection_level: string; km: number }>(
          `
          SELECT b.protection_level::text AS protection_level,
                 (SUM(
                   ST_Length(ST_CollectionExtract(ST_Intersection(b.geometry, wd.geometry), 2)::geography)
                 ) / 1000.0)::float8 AS km
          FROM wards wd
          JOIN bike_infrastructure b
            ON b.geometry && wd.geometry AND ST_Intersects(b.geometry, wd.geometry)
          WHERE wd.id = $1
          GROUP BY b.protection_level
          `,
          [w.id],
        ),
        pool.query<{ total: number; within_100m: number }>(
          `
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (
              WHERE EXISTS (
                SELECT 1 FROM bike_infrastructure b
                WHERE b.protection_level = 'protected'
                  AND ST_DWithin(b.geometry, c.location, 0.002)
                  AND ST_DWithin(b.geometry::geography, c.location::geography, 100)
              )
            )::int AS within_100m
          FROM collisions c
          WHERE c.ward_id = $1
          `,
          [w.id],
        ),
        pool.query<{
          total: number;
          closed: number;
          median_days_to_close: number | null;
          first_year: number | null;
          last_year: number | null;
        }>(
          `
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE closed_at IS NOT NULL)::int AS closed,
            (percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (closed_at - opened_at)) / 86400.0
            ) FILTER (WHERE closed_at IS NOT NULL))::float8 AS median_days_to_close,
            MIN(source_year)::int AS first_year,
            MAX(source_year)::int AS last_year
          FROM requests_311 WHERE ward_id = $1
          `,
          [w.id],
        ),
      ]);

      const kmByLevel: Record<string, number> = { protected: 0, painted: 0, shared: 0 };
      for (const r of lanes.rows) {
        if (r.protection_level in kmByLevel) kmByLevel[r.protection_level] = r.km ?? 0;
      }

      const total = near.rows[0]?.total ?? 0;
      const within = near.rows[0]?.within_100m ?? 0;
      const r311 = requests.rows[0];

      return {
        ward_number: w.ward_number,
        name: w.name,
        bbox: w.bbox,
        ksi_by_year: byYear.rows,
        ksi_total: total,
        km_by_protection: kmByLevel,
        ksi_near_protected_lane: {
          total,
          within_100m: within,
          share: total > 0 ? within / total : null,
        },
        requests_311: {
          total: r311?.total ?? 0,
          closed: r311?.closed ?? 0,
          // Null when no request has a close date; the current ingest does not populate closed_at.
          median_days_to_close: r311?.median_days_to_close ?? null,
          first_year: r311?.first_year ?? null,
          last_year: r311?.last_year ?? null,
        },
      };
    });

    if (!body) throw new HttpError(404, `Ward ${ward} not found`);
    res.json(body);
  }),
);
