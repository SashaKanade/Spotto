import { Router } from "express";
import { z } from "zod";
import { cached, FIVE_MINUTES } from "../cache.js";
import { HttpError, parse, requirePool, route, wardNumberSchema } from "../http.js";

export const briefingRouter = Router();
const schema = z.object({ ward: wardNumberSchema });
briefingRouter.post("/:id/briefing", route(async (req, res) => {
  const { ward } = parse(schema, { ward: req.params.id });
  const lang = z.enum(["en", "fr"]).default("en").safeParse(req.query.lang);
  if (!lang.success) throw new HttpError(400, "lang must be en or fr");
  const pool = requirePool();
  const data = await cached(`briefing:${ward}`, FIVE_MINUTES, async () => {
    const { rows } = await pool.query<{ ward_number: number; name: string; ksi_total: number; protected_km: number; requests: number; first_year: number | null; last_year: number | null }>(
      `SELECT w.ward_number,w.name,COUNT(DISTINCT c.id)::int AS ksi_total,
       COALESCE(l.protected_km,0)::float8 AS protected_km,COUNT(DISTINCT r.id)::int AS requests,
       MIN(c.year)::int AS first_year,MAX(c.year)::int AS last_year
       FROM wards w LEFT JOIN collisions c ON c.ward_id=w.id LEFT JOIN requests_311 r ON r.ward_id=w.id
       LEFT JOIN LATERAL (SELECT SUM(ST_Length(ST_CollectionExtract(ST_Intersection(b.geometry,w.geometry),2)::geography))/1000 AS protected_km FROM bike_infrastructure b WHERE b.protection_level='protected' AND b.geometry && w.geometry AND ST_Intersects(b.geometry,w.geometry)) l ON true
       WHERE w.ward_number=$1 GROUP BY w.id,l.protected_km`, [ward]); return rows[0] ?? null;
  });
  if (!data) throw new HttpError(404, `Ward ${ward} not found`);
  const years = data.first_year && data.last_year ? ` (${data.first_year}${data.first_year === data.last_year ? "" : `–${data.last_year}`})` : "";
  const summary = lang.data === "fr"
    ? `Dans le quartier ${data.ward_number} (${data.name}), les données chargées recensent ${data.ksi_total} collisions cyclistes mortelles ou avec blessures graves signalées par la police${years}, ${data.protected_km.toFixed(1)} km de pistes cyclables protégées et ${data.requests} demandes 311 liées au vélo. Ces chiffres décrivent les données disponibles; ils ne mesurent pas les quasi-accidents. Les lieux des collisions peuvent être généralisés.`
    : `In Ward ${data.ward_number} (${data.name}), the loaded data records ${data.ksi_total} police-reported cyclist KSI collisions${years}, ${data.protected_km.toFixed(1)} km of protected cycling routes, and ${data.requests} bike-related 311 requests. These figures describe the available data; near-misses are not included, and collision locations may be generalized.`;
  res.json({ ward_number: data.ward_number, name: data.name, stats: data, summary });
}));

