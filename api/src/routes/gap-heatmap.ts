import { Router } from "express";
import { z } from "zod";
import { cached, FIVE_MINUTES } from "../cache.js";
import {
  bboxSchema,
  featureCollection,
  limitSchema,
  parse,
  requirePool,
  route,
  wardNumberSchema,
  type GeoJsonFeature,
} from "../http.js";

export const gapHeatmapRouter = Router();

const querySchema = z.object({
  bbox: bboxSchema,
  min_gap: z.coerce.number().min(0).default(0.5),
  limit: limitSchema(5000, 15000),
  ward: wardNumberSchema.optional(),
});

interface HeatRow {
  id: number;
  gap_score: number;
  collision_count: number;
  protection_level: string;
  lng: number;
  lat: number;
}

/**
 * GET /api/gap-heatmap?bbox=w,s,e,n
 * Segment centroids weighted by gap_score for hexbin / heatmap layers.
 */
gapHeatmapRouter.get(
  "/",
  route(async (req, res) => {
    const q = parse(querySchema, req.query);
    const pool = requirePool();
    const [w, s, e, n] = q.bbox;

    const rows = await cached(
      `gap-heatmap:${q.bbox.join(",")}:${q.min_gap}:${q.limit}:${q.ward ?? "all"}`,
      FIVE_MINUTES,
      async () => {
        const result = await pool.query<HeatRow>(
          `
          SELECT
            seg.id,
            st.gap_score,
            st.collision_count,
            st.protection_level::text AS protection_level,
            ST_X(ST_Centroid(seg.geometry)) AS lng,
            ST_Y(ST_Centroid(seg.geometry)) AS lat
          FROM segment_stats st
          JOIN street_segments seg ON seg.id = st.segment_id
          WHERE st.gap_score >= $1
            AND seg.geometry && ST_MakeEnvelope($2, $3, $4, $5, 4326)
            AND (
              $6::int IS NULL
              OR EXISTS (
                SELECT 1 FROM wards w
                WHERE w.ward_number = $6::int AND ST_Intersects(w.geometry, seg.geometry)
              )
            )
          ORDER BY st.gap_score DESC
          LIMIT $7
          `,
          [q.min_gap, w, s, e, n, q.ward ?? null, q.limit],
        );
        return result.rows;
      },
    );

    const features: GeoJsonFeature[] = rows.map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.lng, r.lat] },
      properties: {
        segment_id: r.id,
        gap_score: r.gap_score,
        collision_count: r.collision_count,
        protection_level: r.protection_level,
        weight: r.gap_score,
      },
    }));

    res.json(
      featureCollection(features, {
        count: features.length,
        truncated: features.length === q.limit,
        min_gap: q.min_gap,
      }),
    );
  }),
);
