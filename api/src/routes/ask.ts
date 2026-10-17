import Anthropic from "@anthropic-ai/sdk";
import { Router } from "express";
import { z } from "zod";
import { cached, FIVE_MINUTES } from "../cache.js";
import { HttpError, parse, requirePool, route, wardNumberSchema } from "../http.js";

export const askRouter = Router();
const askSchema = z.object({ question: z.string().trim().min(1).max(1200) });
const pointSchema = z.object({ lat: z.number().min(43.3).max(44), lng: z.number().min(-79.9).max(-78.9), radius_m: z.number().int().min(50).max(2000).default(300) });
const compareSchema = z.object({ ward_a: wardNumberSchema, ward_b: wardNumberSchema });

function tools(client: Anthropic) {
  const pool = requirePool();
  const defs: Anthropic.Tool[] = [
    { name: "get_ward_summary", description: "Get computed descriptive statistics for one Toronto ward.", input_schema: { type: "object", properties: { ward: { type: "integer", minimum: 1, maximum: 25 } }, required: ["ward"], additionalProperties: false } },
    { name: "get_top_corridors", description: "Get the highest gap-score street segments. Ranks locations only.", input_schema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 20 } }, additionalProperties: false } },
    { name: "get_collisions_near_point", description: "Count police-reported cyclist KSI incidents within a radius of a point.", input_schema: { type: "object", properties: { lat: { type: "number", minimum: 43.3, maximum: 44 }, lng: { type: "number", minimum: -79.9, maximum: -78.9 }, radius_m: { type: "integer", minimum: 50, maximum: 2000 } }, required: ["lat", "lng"], additionalProperties: false } },
    { name: "compare_wards", description: "Compare computed descriptive statistics for two wards.", input_schema: { type: "object", properties: { ward_a: { type: "integer", minimum: 1, maximum: 25 }, ward_b: { type: "integer", minimum: 1, maximum: 25 } }, required: ["ward_a", "ward_b"], additionalProperties: false } },
  ];
  const call = async (name: string, input: unknown): Promise<unknown> => {
    if (name === "get_ward_summary") {
      const { ward } = parse(z.object({ ward: wardNumberSchema }), input);
      return cached(`ask:ward:${ward}`, FIVE_MINUTES, async () => {
        const { rows } = await pool.query(`SELECT w.ward_number,w.name,COUNT(DISTINCT c.id)::int AS ksi_total,
          COALESCE(MAX(l.km_protected),0)::float8 AS km_protected,
          COUNT(DISTINCT r.id)::int AS requests_311
          FROM wards w LEFT JOIN collisions c ON c.ward_id=w.id LEFT JOIN requests_311 r ON r.ward_id=w.id
          LEFT JOIN LATERAL (SELECT SUM(ST_Length(ST_CollectionExtract(ST_Intersection(b.geometry,w.geometry),2)::geography))/1000.0 AS km_protected FROM bike_infrastructure b WHERE b.protection_level='protected' AND b.geometry && w.geometry AND ST_Intersects(b.geometry,w.geometry)) l ON true
          WHERE w.ward_number=$1 GROUP BY w.id`, [ward]); return rows[0] ?? { error: "Ward not found" };
      });
    }
    if (name === "get_top_corridors") {
      const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(20).default(10) }), input);
      return cached(`ask:corridors:${limit}`, FIVE_MINUTES, async () => (await pool.query(`SELECT s.linear_name_full AS street_name,st.collision_count,st.protection_level::text,st.gap_score,st.dead_end_protected FROM segment_stats st JOIN street_segments s ON s.id=st.segment_id WHERE st.collision_count>0 ORDER BY st.gap_score DESC,st.collision_count DESC,s.id LIMIT $1`, [limit])).rows);
    }
    if (name === "get_collisions_near_point") {
      const q = parse(pointSchema, input);
      return cached(`ask:point:${q.lat}:${q.lng}:${q.radius_m}`, FIVE_MINUTES, async () => (await pool.query(`SELECT COUNT(*)::int AS count,MIN(year)::int AS first_year,MAX(year)::int AS last_year FROM collisions WHERE ST_DWithin(location::geography,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,$3)`, [q.lng,q.lat,q.radius_m])).rows[0]);
    }
    const q = parse(compareSchema, input);
    return Promise.all([call("get_ward_summary", { ward: q.ward_a }), call("get_ward_summary", { ward: q.ward_b })]);
  };
  return { defs, call };
}

askRouter.post("/ask", route(async (req, res) => {
  const { question } = parse(askSchema, req.body);
  if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(503, "AI service is not configured");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const { defs, call } = tools(client);
  const used: { tool: string; input: unknown; result: unknown }[] = [];
  let messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];
  let answer = "The data doesn't show that.";
  for (let turn = 0; turn < 4; turn++) {
    const response = await client.messages.create({ model: "claude-3-5-haiku-latest", max_tokens: 700, system: "You are a neutral Toronto civic data assistant. Answer only using the supplied predefined tools. Do not make endorsements, criticize or praise councillors/candidates, predict elections, recommend votes, or speculate beyond tool results. If requested information is not in the data, say 'the data doesn't show that'. State that collision data covers police-reported KSI only, locations may be generalized, and near-misses are not included when relevant. Cite the figures used. Never invent data.", tools: defs, tool_choice: { type: "any" }, messages });
    const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!calls.length) { answer = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n") || answer; break; }
    messages = [...messages, { role: "assistant", content: response.content }];
    const results = [];
    for (const c of calls) { const result = await call(c.name, c.input); used.push({ tool: c.name, input: c.input, result }); results.push({ type: "tool_result" as const, tool_use_id: c.id, content: JSON.stringify(result) }); }
    messages = [...messages, { role: "user", content: results }];
  }
  res.json({ answer, numbers_used: used });
}));

