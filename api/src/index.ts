import cors from "cors";
import express from "express";
import { pool } from "./db.js";
import { errorHandler } from "./http.js";
import { hotspotsRouter } from "./routes/hotspots.js";
import { layersRouter } from "./routes/layers.js";
import { metaRouter } from "./routes/meta.js";
import { segmentsRouter } from "./routes/segments.js";
import { wardsRouter } from "./routes/wards.js";

const app = express();
const port = Number(process.env.PORT) || 3001;
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

app.use(cors({ origin: corsOrigin }));
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
app.use("/api/wards", wardsRouter);
app.use("/api/segments", segmentsRouter);
app.use("/api", layersRouter); // /api/collisions, /api/bike-lanes

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});
app.use(errorHandler);

app.listen(port, () => {
  console.log(`Safe Streets TO API listening on http://localhost:${port}`);
});
