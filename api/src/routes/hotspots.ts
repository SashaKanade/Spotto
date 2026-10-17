import { Router } from "express";
import { z } from "zod";
import { cached, FIVE_MINUTES } from "../cache.js";
import {
  featureCollection,
  limitSchema,
  parse,
  requirePool,
  route,
  wardNumberSchema,
  type GeoJsonFeature,
} from "../http.js";

export const hotspotsRouter = Router();

const querySchema = z.object({
  limit: limitSchema(20, 100),
  ward: wardNumberSchema.optional(),
  /** Segments with no recorded cyclist KSI are not hotspots; default requires at least one. */
  min_collisions: z.coerce.number().int().min(0).max(1000).default(1),
});

interface HotspotRow {
  id: number;
  centreline_id: string;
  street_name: string | null;
  length_m: number | null;
  collision_count: number;
  protection_level: "protected" | "painted" | "shared" | "none";
  gap_score: number;
  dead_end_protected: boolean;
  geometry: unknown;
}

/**
 * GET /api/hotspots
 * Street segments ranked by the precomputed gap_score (cyclist KSI count combined
 * with protection level; see refreshSegmentStats in db/scripts/lib/spatial.ts).
 * Descriptive only: this ranks locations on a map, never people.
 */
hotspotsRouter.get(
  "/",
  route(async (req, res) => {
    const q = parse(querySchema, req.query);
    const pool = requirePool();

    const rows = await cached(
      `hotspots:${q.limit}:${q.ward ?? "all"}:${q.min_collisions}`,
      FIVE_MINUTES,
      async () => {
        const result = await pool.query<HotspotRow>(
          `
          SELECT
            s.id,
            s.centreline_id::text AS centreline_id,
            s.linear_name_full AS street_name,
            s.length_m,
            st.collision_count,
            st.protection_level::text AS protection_level,
            st.gap_score,
            st.dead_end_protected,
            ST_AsGeoJSON(s.geometry, 6)::json AS geometry
          FROM segment_stats st
          JOIN street_segments s ON s.id = st.segment_id
          WHERE st.collision_count >= $1
            AND (
              $2::int IS NULL
              OR EXISTS (
                SELECT 1 FROM wards w
                WHERE w.ward_number = $2::int AND ST_Intersects(w.geometry, s.geometry)
              )
            )
          ORDER BY st.gap_score DESC, st.collision_count DESC, s.id
          LIMIT $3
          `,
          [q.min_collisions, q.ward ?? null, q.limit],
        );
        return result.rows;
      },
    );

    const features: GeoJsonFeature[] = rows.map((r, i) => {
      const { geometry, ...properties } = r;
      return { type: "Feature", geometry, properties: { rank: i + 1, ...properties } };
    });

    res.json(
      featureCollection(features, {
        count: features.length,
        ward: q.ward ?? null,
        min_collisions: q.min_collisions,
        note: "Ranked by gap_score = 10 x cyclist KSI count + a penalty for lower protection. Police-reported KSI only; locations may be generalized.",
      }),
    );
  }),
);
