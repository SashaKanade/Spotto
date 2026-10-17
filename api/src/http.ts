import type { NextFunction, Request, RequestHandler, Response } from "express";
import type pg from "pg";
import { z } from "zod";
import { pool } from "./db.js";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Express 4 does not catch rejected promises, so forward them to the error middleware. */
export function route(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

export function requirePool(): pg.Pool {
  if (!pool) throw new HttpError(503, "DATABASE_URL not configured");
  return pool;
}

export function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new HttpError(
      400,
      "Invalid request parameters",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  // 42P01 = undefined_table: migrations have not been applied yet.
  if (typeof err === "object" && err !== null && (err as { code?: string }).code === "42P01") {
    res.status(503).json({ error: "Database is not migrated. Run `npm run db:migrate`." });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}

// ---- shared query-parameter schemas -------------------------------------

/** "west,south,east,north" in WGS84 degrees. */
export const bboxSchema = z
  .string()
  .transform((s) => s.split(",").map((p) => Number(p.trim())))
  .refine((p) => p.length === 4 && p.every(Number.isFinite), {
    message: "bbox must be four numbers: west,south,east,north",
  })
  .refine(
    ([w, s, e, n]) =>
      w >= -180 && e <= 180 && s >= -90 && n <= 90 && w < e && s < n,
    { message: "bbox must be within lon/lat bounds with west<east and south<north" },
  )
  .transform((p) => p as [number, number, number, number]);

export const wardNumberSchema = z.coerce.number().int().min(1).max(25);

export const protectionSchema = z.enum(["protected", "painted", "shared", "none"]);

export const limitSchema = (def: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(def);

// ---- GeoJSON helpers -----------------------------------------------------

export interface GeoJsonFeature<P = Record<string, unknown>> {
  type: "Feature";
  geometry: unknown;
  properties: P;
}

export function featureCollection<P>(
  features: GeoJsonFeature<P>[],
  meta?: Record<string, unknown>,
) {
  return { type: "FeatureCollection" as const, features, ...(meta ? { meta } : {}) };
}
