import { Router } from "express";
import { z } from "zod";
import {
  bboxSchema,
  featureCollection,
  HttpError,
  limitSchema,
  parse,
  protectionSchema,
  requirePool,
  route,
  type GeoJsonFeature,
} from "../http.js";

export const segmentsRouter = Router();

const listSchema = z.object({
  bbox: bboxSchema,
  protection: protectionSchema.optional(),
  min_gap: z.coerce.number().min(0).default(0),
  limit: limitSchema(2000, 10000),
});

interface SegmentRow {
  id: number;
  centreline_id: string;
  street_name: string | null;
  length_m: number | null;
  collision_count: number;
  protection_level: string;
  gap_score: number;
  dead_end_protected: boolean;
  geometry: unknown;
}

/**
 * GET /api/segments?bbox=w,s,e,n[&protection=][&min_gap=][&limit=]
 * Street centreline segments in the viewport with their precomputed stats.
 * Segments without a segment_stats row are reported as zero collisions / no protection.
 */
segmentsRouter.get(
  "/",
  route(async (req, res) => {
    const q = parse(listSchema, req.query);
    const pool = requirePool();
    const [w, s, e, n] = q.bbox;

    const { rows } = await pool.query<SegmentRow>(
      `
      SELECT
        seg.id,
        seg.centreline_id::text AS centreline_id,
        seg.linear_name_full AS street_name,
        seg.length_m,
        COALESCE(st.collision_count, 0) AS collision_count,
        COALESCE(st.protection_level, 'none')::text AS protection_level,
        COALESCE(st.gap_score, 0) AS gap_score,
        COALESCE(st.dead_end_protected, false) AS dead_end_protected,
        ST_AsGeoJSON(seg.geometry, 6)::json AS geometry
      FROM street_segments seg
      LEFT JOIN segment_stats st ON st.segment_id = seg.id
      WHERE seg.geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326)
        AND ($5::text IS NULL OR COALESCE(st.protection_level, 'none')::text = $5::text)
        AND COALESCE(st.gap_score, 0) >= $6
      ORDER BY COALESCE(st.gap_score, 0) DESC, seg.id
      LIMIT $7
      `,
      [w, s, e, n, q.protection ?? null, q.min_gap, q.limit],
    );

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

const idSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * GET /api/segments/:id
 * One segment with its stats, the cyclist KSI collisions snapped to it, and the
 * bike infrastructure within 25 m (the same radius used to compute protection_level).
 */
segmentsRouter.get(
  "/:id",
  route(async (req, res) => {
    const { id } = parse(idSchema, req.params);
    const pool = requirePool();

    const [segment, collisions, infrastructure] = await Promise.all([
      pool.query<SegmentRow>(
        `
        SELECT
          seg.id,
          seg.centreline_id::text AS centreline_id,
          seg.linear_name_full AS street_name,
          seg.length_m,
          COALESCE(st.collision_count, 0) AS collision_count,
          COALESCE(st.protection_level, 'none')::text AS protection_level,
          COALESCE(st.gap_score, 0) AS gap_score,
          COALESCE(st.dead_end_protected, false) AS dead_end_protected,
          ST_AsGeoJSON(seg.geometry, 6)::json AS geometry
        FROM street_segments seg
        LEFT JOIN segment_stats st ON st.segment_id = seg.id
        WHERE seg.id = $1
        `,
        [id],
      ),
      pool.query(
        `
        SELECT id, to_char(occurred_on, 'YYYY-MM-DD') AS occurred_on, year, injury, stname1, stname2
        FROM collisions
        WHERE nearest_segment_id = $1
        ORDER BY occurred_on DESC
        LIMIT 100
        `,
        [id],
      ),
      pool.query(
        `
        SELECT DISTINCT b.street_name, b.infra_highorder, b.infra_loworder,
               b.protection_level::text AS protection_level
        FROM bike_infrastructure b
        JOIN street_segments seg ON seg.id = $1
        WHERE ST_DWithin(b.geometry, seg.geometry, 0.0005)
          AND ST_DWithin(b.geometry::geography, seg.geometry::geography, 25)
        LIMIT 20
        `,
        [id],
      ),
    ]);

    const row = segment.rows[0];
    if (!row) throw new HttpError(404, `Segment ${id} not found`);

    const { geometry, ...properties } = row;
    res.json({
      type: "Feature",
      geometry,
      properties: {
        ...properties,
        collisions: collisions.rows,
        nearby_infrastructure: infrastructure.rows,
      },
    });
  }),
);
