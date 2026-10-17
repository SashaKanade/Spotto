import { Router } from "express";
import { z } from "zod";
import { bboxSchema, parse, requirePool, route, wardNumberSchema } from "../http.js";

export const exportsRouter = Router();
const schema = z.object({
  layer: z.enum(["collisions", "bike-lanes", "corridors"]),
  format: z.enum(["geojson", "csv"]).default("geojson"),
  ward: wardNumberSchema.optional(),
  bbox: bboxSchema.optional(),
});

exportsRouter.get("/", route(async (req, res) => {
  const q = parse(schema, req.query);
  const pool = requirePool();
  const [west, south, east, north] = q.bbox ?? [null, null, null, null];
  let result;
  if (q.layer === "collisions") {
    result = await pool.query(`SELECT json_build_object('type','Feature','geometry',ST_AsGeoJSON(c.location,6)::json,'properties',json_build_object('collision_id',c.collision_id,'occurred_on',c.occurred_on,'year',c.year,'injury',c.injury,'street_1',c.stname1,'street_2',c.stname2,'ward_number',w.ward_number)) AS feature FROM collisions c LEFT JOIN wards w ON w.id=c.ward_id WHERE ($1::int IS NULL OR w.ward_number=$1) AND ($2::float8 IS NULL OR c.location && ST_MakeEnvelope($2,$3,$4,$5,4326)) ORDER BY c.occurred_on,c.id LIMIT 50000`, [q.ward ?? null, west,south,east,north]);
  } else if (q.layer === "bike-lanes") {
    result = await pool.query(`SELECT json_build_object('type','Feature','geometry',ST_AsGeoJSON(b.geometry,5)::json,'properties',json_build_object('street_name',b.street_name,'from_street',b.from_street,'to_street',b.to_street,'infrastructure',b.infra_highorder,'protection_level',b.protection_level,'installed_year',b.installed_year,'ward_number',w.ward_number)) AS feature FROM bike_infrastructure b LEFT JOIN LATERAL (SELECT ward_number FROM wards WHERE ST_Intersects(geometry,b.geometry) ORDER BY ward_number LIMIT 1) w ON true WHERE ($1::int IS NULL OR EXISTS (SELECT 1 FROM wards wx WHERE wx.ward_number=$1 AND ST_Intersects(wx.geometry,b.geometry))) AND ($2::float8 IS NULL OR b.geometry && ST_MakeEnvelope($2,$3,$4,$5,4326)) ORDER BY b.id LIMIT 50000`, [q.ward ?? null,west,south,east,north]);
  } else {
    result = await pool.query(`SELECT json_build_object('type','Feature','geometry',ST_AsGeoJSON(s.geometry,6)::json,'properties',json_build_object('street_name',s.linear_name_full,'collision_count',st.collision_count,'protection_level',st.protection_level,'gap_score',st.gap_score,'dead_end_protected',st.dead_end_protected,'ward_number',w.ward_number)) AS feature FROM segment_stats st JOIN street_segments s ON s.id=st.segment_id LEFT JOIN LATERAL (SELECT ward_number FROM wards WHERE ST_Intersects(geometry,s.geometry) ORDER BY ward_number LIMIT 1) w ON true WHERE st.collision_count>0 AND ($1::int IS NULL OR EXISTS (SELECT 1 FROM wards wx WHERE wx.ward_number=$1 AND ST_Intersects(wx.geometry,s.geometry))) AND ($2::float8 IS NULL OR s.geometry && ST_MakeEnvelope($2,$3,$4,$5,4326)) ORDER BY st.gap_score DESC LIMIT 50000`, [q.ward ?? null,west,south,east,north]);
  }
  const features = result.rows.map((row) => row.feature);
  const date = new Date().toISOString().slice(0,10);
  if (q.format === "geojson") {
    res.setHeader("Content-Type", "application/geo+json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="ssto-${q.layer}${q.ward ? `-ward-${q.ward}` : "-view"}-${date}.geojson"`);
    res.json({ type: "FeatureCollection", features, meta: { count: features.length, limit: 50000, truncated: features.length === 50000, caveat: "Cyclist collision data includes police-reported KSI only; locations may be generalized; near-misses are not included." } });
  } else {
    const props: Record<string, unknown>[] = features.map((f: { geometry: unknown; properties: Record<string, unknown> }) => ({ ...f.properties, geometry: JSON.stringify(f.geometry) }));
    const headers = [...new Set(props.flatMap((row) => Object.keys(row)))];
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"','""')}"`;
    const csv = [headers.map(quote).join(","), ...props.map((row) => headers.map((h) => quote(row[h])).join(","))].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="ssto-${q.layer}${q.ward ? `-ward-${q.ward}` : "-view"}-${date}.csv"`);
    res.send(csv);
  }
}));
