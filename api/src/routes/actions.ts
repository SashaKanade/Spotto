import { Router } from "express";
import { z } from "zod";
import { cached, FIVE_MINUTES } from "../cache.js";
import { parse, requirePool, route } from "../http.js";

export const actionsRouter = Router();

const locationSchema = z.object({
  lat: z.coerce.number().min(43.3).max(44.0),
  lng: z.coerce.number().min(-79.9).max(-78.9),
  radius_m: z.coerce.number().int().min(50).max(1000).default(300),
});

actionsRouter.get("/location-summary", route(async (req, res) => {
  const q = parse(locationSchema, req.query);
  const pool = requirePool();
  const result = await cached(`actions:location:${q.lat.toFixed(4)}:${q.lng.toFixed(4)}:${q.radius_m}`, FIVE_MINUTES, async () => {
    const { rows } = await pool.query<{ count: number; first_year: number | null; last_year: number | null; ward_number: number | null; ward_name: string | null }>(
      `SELECT COUNT(c.id)::int AS count, MIN(c.year)::int AS first_year, MAX(c.year)::int AS last_year,
              (SELECT w.ward_number FROM wards w WHERE ST_Contains(w.geometry, ST_SetSRID(ST_MakePoint($1,$2),4326)) LIMIT 1) AS ward_number,
              (SELECT w.name FROM wards w WHERE ST_Contains(w.geometry, ST_SetSRID(ST_MakePoint($1,$2),4326)) LIMIT 1) AS ward_name
       FROM collisions c WHERE ST_DWithin(c.location::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $3)`,
      [q.lng, q.lat, q.radius_m]);
    return rows[0];
  });
  res.json({ ...result, radius_m: q.radius_m, caveat: "Police-reported cyclist KSI incidents only; locations may be generalized. Near-misses are not included." });
}));

