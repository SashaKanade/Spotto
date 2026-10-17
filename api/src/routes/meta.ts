import { Router } from "express";
import { requirePool, route } from "../http.js";

export const metaRouter = Router();

/**
 * GET /api/meta
 * Latest refresh per dataset from ingest_log, plus the standing data caveats the
 * site must show next to any map or statistic.
 */
metaRouter.get(
  "/",
  route(async (_req, res) => {
    const pool = requirePool();
    const { rows } = await pool.query<{
      dataset_name: string;
      source_url: string;
      row_count: number;
      refreshed_at: Date;
    }>(
      `
      SELECT DISTINCT ON (dataset_name) dataset_name, source_url, row_count, refreshed_at
      FROM ingest_log
      ORDER BY dataset_name, refreshed_at DESC
      `,
    );

    const lastRefreshed = rows.reduce<Date | null>(
      (latest, r) => (latest === null || r.refreshed_at > latest ? r.refreshed_at : latest),
      null,
    );

    res.json({
      last_refreshed: lastRefreshed,
      datasets: rows,
      caveats: [
        "Collision data covers only police-reported killed or seriously injured (KSI) incidents involving cyclists.",
        "Collision locations may be generalized in the source data (for example to an intersection).",
        "Near-misses and unreported incidents are not included.",
      ],
    });
  }),
);
