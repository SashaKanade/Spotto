import { Router } from "express";
import { cached, ONE_HOUR } from "../cache.js";
import { requirePool, route } from "../http.js";

export const methodologyRouter = Router();

/**
 * GET /api/methodology
 * Documents the gap formula (mirrors PostgreSQL functions in 003_gap_engine.sql).
 */
methodologyRouter.get(
  "/",
  route(async (_req, res) => {
    const pool = requirePool();

    const stats = await cached("methodology:stats", ONE_HOUR, async () => {
      const { rows } = await pool.query<{
        segments: string;
        with_ksi: string;
        dead_ends: string;
        max_gap: string;
      }>(`
        SELECT
          COUNT(*)::text AS segments,
          COUNT(*) FILTER (WHERE collision_count > 0)::text AS with_ksi,
          COUNT(*) FILTER (WHERE dead_end_protected)::text AS dead_ends,
          COALESCE(MAX(gap_score), 0)::text AS max_gap
        FROM segment_stats
      `);
      return rows[0];
    });

    res.json({
      data_scope: {
        cyclist_ksi_from_year: new Date().getUTCFullYear() - 4,
        requests_311_years: [new Date().getUTCFullYear() - 3, new Date().getUTCFullYear() - 2, new Date().getUTCFullYear() - 1],
        note: "Current boundary and network reference datasets are loaded as current snapshots.",
      },
      gap_formula: {
        expression: "(cyclist_KSI_count × 10) + protection_penalty + dead_end_bonus",
        collision_weight: 10,
        protection_penalty: {
          none: 5,
          shared: 3,
          painted: 2,
          protected: 0,
        },
        dead_end_bonus: 4,
        dead_end_definition:
          "A centreline segment whose nearby infrastructure (approximately 25 m) is protected, but at least one endpoint lies within approximately 20 m of another segment whose best protection is not protected. Distances use local coordinate thresholds for Toronto.",
      },
      protection_level: {
        radius_m: 25,
        source: "Toronto Cycling Network INFRA_HIGHORDER mapped to protected / painted / shared / none.",
      },
      collisions: {
        filter: "road_user = cyclist in police-reported KSI dataset",
        snap: "Each collision point snapped to nearest centreline segment (nearest_segment_id).",
      },
      ranking: {
        corridors: "Top segments by gap_score descending; ties broken by collision_count then segment id.",
        descriptive_only:
          "Ranks street segments for planning context. Does not rank councillors, candidates, or voters.",
      },
      computed_stats: stats
        ? {
            segment_count: Number(stats.segments),
            segments_with_cyclist_ksi: Number(stats.with_ksi),
            dead_end_segments: Number(stats.dead_ends),
            max_gap_score: Number(stats.max_gap),
          }
        : null,
    });
  }),
);
