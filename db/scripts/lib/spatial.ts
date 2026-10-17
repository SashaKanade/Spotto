import type pg from "pg";

export async function assignWardIdsFromGeometry(
  client: pg.PoolClient,
  table: string,
  geomColumn: string,
): Promise<number> {
  const { rows } = await client.query<{ count: string }>(
    `
    WITH updated AS (
      UPDATE ${table} t
      SET ward_id = w.id,
          updated_at = now()
      FROM wards w
      WHERE t.${geomColumn} IS NOT NULL
        AND ST_Contains(w.geometry, t.${geomColumn})
      RETURNING t.id
    )
    SELECT COUNT(*)::text AS count FROM updated
    `,
  );
  return Number.parseInt(rows[0]?.count ?? "0", 10);
}

export async function snapPointsToNearestSegment(
  client: pg.PoolClient,
  table: string,
  pointColumn: string,
  targetColumn = "nearest_segment_id",
): Promise<number> {
  const { rows } = await client.query<{ count: string }>(
    `
    WITH updated AS (
      UPDATE ${table} t
      SET ${targetColumn} = (
            SELECT s.id FROM street_segments s
            ORDER BY s.geometry <-> t.${pointColumn}
            LIMIT 1
          ),
          updated_at = now()
      WHERE t.${pointColumn} IS NOT NULL
      RETURNING t.id
    )
    SELECT COUNT(*)::text AS count FROM updated
    `,
  );
  return Number.parseInt(rows[0]?.count ?? "0", 10);
}

export async function snapBikeInfraToNearestSegment(client: pg.PoolClient): Promise<number> {
  const { rows } = await client.query<{ count: string }>(
    `
    WITH updated AS (
      UPDATE bike_infrastructure b
      SET nearest_segment_id = (
            SELECT s.id FROM street_segments s
            ORDER BY s.geometry <-> ST_Centroid(b.geometry)
            LIMIT 1
          ),
          updated_at = now()
      RETURNING b.id
    )
    SELECT COUNT(*)::text AS count FROM updated
    `,
  );
  return Number.parseInt(rows[0]?.count ?? "0", 10);
}

/** Approximate intersection point from two street names via centreline matching. */
export async function geocode311Intersections(client: pg.PoolClient): Promise<number> {
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_street_segments_name_pattern
     ON street_segments (lower(linear_name_full) text_pattern_ops)`,
  );
  await client.query(`
    CREATE TEMP TABLE ssto_311_intersection_pairs ON COMMIT DROP AS
    SELECT row_number() OVER (ORDER BY street_1, street_2)::int AS id,
           street_1, street_2, false AS processed
    FROM (
      SELECT DISTINCT lower(trim(intersection_street_1)) AS street_1,
                      lower(trim(intersection_street_2)) AS street_2
      FROM requests_311
      WHERE geometry IS NULL
        AND intersection_street_1 IS NOT NULL AND trim(intersection_street_1) <> ''
        AND intersection_street_2 IS NOT NULL AND trim(intersection_street_2) <> ''
    ) pairs
  `);

  let totalUpdated = 0;
  while (true) {
    const { rows } = await client.query<{ count: string; processed: number }>(
      `WITH selected_pairs AS MATERIALIZED (
         SELECT id, street_1, street_2 FROM ssto_311_intersection_pairs
         WHERE NOT processed ORDER BY id LIMIT 100
       ),
       candidates AS (
         SELECT p.street_1, p.street_2,
           (SELECT ST_LineInterpolatePoint(
              ST_MakeLine(ST_ClosestPoint(s1.geometry,s2.geometry), ST_ClosestPoint(s2.geometry,s1.geometry)), 0.5
            )
            FROM street_segments s1
            JOIN LATERAL (
              SELECT s2.id, s2.geometry FROM street_segments s2
              WHERE lower(s2.linear_name_full) LIKE p.street_2 || '%'
                AND ST_DWithin(s2.geometry,s1.geometry,0.0003)
              ORDER BY s2.geometry <-> s1.geometry LIMIT 1
            ) s2 ON true
            WHERE lower(s1.linear_name_full) LIKE p.street_1 || '%'
            ORDER BY s1.geometry <-> s2.geometry LIMIT 1) AS geom
         FROM selected_pairs p
       ),
       updated AS (
         UPDATE requests_311 r SET geometry=c.geom, updated_at=now()
         FROM candidates c
         WHERE r.geometry IS NULL AND c.geom IS NOT NULL
           AND lower(trim(r.intersection_street_1))=c.street_1
           AND lower(trim(r.intersection_street_2))=c.street_2
         RETURNING r.id
       ),
       marked AS (
         UPDATE ssto_311_intersection_pairs p SET processed=true
         FROM selected_pairs s WHERE p.id=s.id RETURNING p.id
       )
       SELECT (SELECT COUNT(*)::text FROM updated) AS count,
              (SELECT COUNT(*)::int FROM marked) AS processed`,
    );
    const processed = rows[0]?.processed ?? 0;
    totalUpdated += Number.parseInt(rows[0]?.count ?? "0", 10);
    if (processed === 0) break;
  }
  return totalUpdated;
}

export async function assign311WardIdsByNumber(client: pg.PoolClient): Promise<number> {
  const { rows } = await client.query<{ count: string }>(
    `
    WITH parsed AS (
      SELECT
        r.id,
        (regexp_match(r.ward_name, '\\((\\d{1,2})\\)\\s*$'))[1]::smallint AS ward_num
      FROM requests_311 r
      WHERE r.ward_id IS NULL AND r.ward_name IS NOT NULL
    ),
    updated AS (
      UPDATE requests_311 r
      SET ward_id = w.id,
          updated_at = now()
      FROM parsed p
      INNER JOIN wards w ON w.ward_number = p.ward_num
      WHERE r.id = p.id
      RETURNING r.id
    )
    SELECT COUNT(*)::text AS count FROM updated
    `,
  );
  return Number.parseInt(rows[0]?.count ?? "0", 10);
}

/** Delegates to PostgreSQL refresh_segment_stats() (see db/migrations/003_gap_engine.sql). */
export async function refreshSegmentStats(client: pg.PoolClient): Promise<number> {
  const { rows } = await client.query<{ refresh_segment_stats: number }>(
    `SELECT refresh_segment_stats() AS refresh_segment_stats`,
  );
  return rows[0]?.refresh_segment_stats ?? 0;
}
