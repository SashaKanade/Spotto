import { Router } from "express";
import { z } from "zod";
import { cached, FIVE_MINUTES } from "../cache.js";
import {
  bboxSchema,
  featureCollection,
  limitSchema,
  parse,
  protectionSchema,
  requirePool,
  route,
  wardNumberSchema,
  type GeoJsonFeature,
} from "../http.js";

/** Map layer data used by the toggles: cyclist KSI collisions and bike lanes. */
export const layersRouter = Router();

const collisionsSchema = z.object({
  bbox: bboxSchema.optional(),
  ward: wardNumberSchema.optional(),
  year_from: z.coerce.number().int().min(1990).max(2100).optional(),
  year_to: z.coerce.number().int().min(1990).max(2100).optional(),
  limit: limitSchema(5000, 20000),
});

/**
 * GET /api/collisions
 * Cyclist killed-or-seriously-injured collisions (police-reported). Locations in the
 * source data may be generalized to the nearest intersection or block.
 */
layersRouter.get(
  "/collisions",
  route(async (req, res) => {
    const q = parse(collisionsSchema, req.query);
    const pool = requirePool();
    const [w, s, e, n] = q.bbox ?? [null, null, null, null];

    const key = `collisions:${[w, s, e, n, q.ward, q.year_from, q.year_to, q.limit].join("|")}`;
    const rows = await cached(key, FIVE_MINUTES, async () => {
      const result = await pool.query(
        `
        SELECT
          c.id,
          c.collision_id,
          to_char(c.occurred_on, 'YYYY-MM-DD') AS occurred_on,
          c.year::int AS year,
          c.injury,
          c.stname1,
          c.stname2,
          wd.ward_number,
          ST_AsGeoJSON(c.location, 6)::json AS geometry
        FROM collisions c
        LEFT JOIN wards wd ON wd.id = c.ward_id
        WHERE ($1::float8 IS NULL OR c.location && ST_MakeEnvelope($1, $2, $3, $4, 4326))
          AND ($5::int IS NULL OR wd.ward_number = $5::int)
          AND ($6::int IS NULL OR c.year >= $6::int)
          AND ($7::int IS NULL OR c.year <= $7::int)
        ORDER BY c.occurred_on DESC, c.id
        LIMIT $8
        `,
        [w, s, e, n, q.ward ?? null, q.year_from ?? null, q.year_to ?? null, q.limit],
      );
      return result.rows as Array<{ geometry: unknown } & Record<string, unknown>>;
    });

    const features: GeoJsonFeature[] = rows.map(({ geometry, ...properties }) => ({
      type: "Feature",
      geometry,
      properties,
    }));
    res.json(
      featureCollection(features, { count: features.length, truncated: features.length === q.limit }),
    );
  }),
);

const bikeLanesSchema = z.object({
  bbox: bboxSchema.optional(),
  protection: protectionSchema.optional(),
  limit: limitSchema(20000, 50000),
});

/** GET /api/bike-lanes — Cycling Network features with normalized protection level. */
layersRouter.get(
  "/bike-lanes",
  route(async (req, res) => {
    const q = parse(bikeLanesSchema, req.query);
    const pool = requirePool();
    const [w, s, e, n] = q.bbox ?? [null, null, null, null];

    const key = `bike-lanes:${[w, s, e, n, q.protection, q.limit].join("|")}`;
    const rows = await cached(key, FIVE_MINUTES, async () => {
      const result = await pool.query(
        `
        SELECT
          b.id,
          b.street_name,
          b.from_street,
          b.to_street,
          b.infra_highorder,
          b.infra_loworder,
          b.protection_level::text AS protection_level,
          b.installed_year,
          ST_AsGeoJSON(b.geometry, 5)::json AS geometry
        FROM bike_infrastructure b
        WHERE ($1::float8 IS NULL OR b.geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326))
          AND ($5::text IS NULL OR b.protection_level::text = $5::text)
        ORDER BY b.id
        LIMIT $6
        `,
        [w, s, e, n, q.protection ?? null, q.limit],
      );
      return result.rows as Array<{ geometry: unknown } & Record<string, unknown>>;
    });

    const features: GeoJsonFeature[] = rows.map(({ geometry, ...properties }) => ({
      type: "Feature",
      geometry,
      properties,
    }));
    res.json(
      featureCollection(features, { count: features.length, truncated: features.length === q.limit }),
    );
  }),
);
