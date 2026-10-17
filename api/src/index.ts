import cors from "cors";
import express from "express";
import { pool } from "./db.js";
import { errorHandler } from "./http.js";
import { gapHeatmapRouter } from "./routes/gap-heatmap.js";
import { hotspotsRouter } from "./routes/hotspots.js";
import { methodologyRouter } from "./routes/methodology.js";
import { layersRouter } from "./routes/layers.js";
import { metaRouter } from "./routes/meta.js";
import { segmentsRouter } from "./routes/segments.js";
import { wardsRouter } from "./routes/wards.js";
import { actionsRouter } from "./routes/actions.js";
import { askRouter } from "./routes/ask.js";
import { briefingRouter } from "./routes/briefing.js";
import { exportsRouter } from "./routes/exports.js";

const app = express();
const port = Number(process.env.PORT) || 3001;
const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: (origin, callback) => {
  if (!origin || corsOrigins.includes(origin)) callback(null, true);
  else callback(new Error("Origin is not allowed by CORS"));
} }));
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  if (!pool) {
    res.status(503).json({ ok: false, error: "DATABASE_URL not configured" });
    return;
  }
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({
      ok: false,
      error: err instanceof Error ? err.message : "Database unavailable",
    });
  }
});

app.use("/api/meta", metaRouter);
app.use("/api/hotspots", hotspotsRouter);
app.use("/api/gap-heatmap", gapHeatmapRouter);
app.use("/api/methodology", methodologyRouter);
app.use("/api/wards", wardsRouter);
app.use("/api/ward", briefingRouter);
app.use("/api", askRouter);
app.use("/api/actions", actionsRouter);
app.use("/api/exports", exportsRouter);
app.use("/api/segments", segmentsRouter);
app.use("/api", layersRouter); // /api/collisions, /api/bike-lanes

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});
app.use(errorHandler);

app.listen(port, () => {
  console.log(`Safe Streets TO API listening on http://localhost:${port}`);
});
