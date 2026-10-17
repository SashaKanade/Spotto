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
      SET ${targetColumn} = nearest.id,
          updated_at = now()
      FROM LATERAL (
        SELECT s.id
        FROM street_segments s
        ORDER BY s.geometry <-> t.${pointColumn}
        LIMIT 1
      ) nearest
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
      SET nearest_segment_id = nearest.id,
          updated_at = now()
      FROM LATERAL (
        SELECT s.id
        FROM street_segments s
        ORDER BY s.geometry <-> ST_Centroid(b.geometry)
        LIMIT 1
      ) nearest
      RETURNING b.id
    )
    SELECT COUNT(*)::text AS count FROM updated
    `,
  );
  return Number.parseInt(rows[0]?.count ?? "0", 10);
}

/** Approximate intersection point from two street names via centreline matching. */
export async function geocode311Intersections(client: pg.PoolClient): Promise<number> {
  const { rows } = await client.query<{ count: string }>(
    `
    WITH candidates AS (
      SELECT
        r.id,
        (
          SELECT ST_LineInterpolatePoint(
            ST_MakeLine(
              ST_ClosestPoint(s1.geometry, s2.geometry),
              ST_ClosestPoint(s2.geometry, s1.geometry)
            ),
            0.5
          )
          FROM street_segments s1
          INNER JOIN street_segments s2 ON s1.id <> s2.id
          WHERE r.intersection_street_1 IS NOT NULL
            AND r.intersection_street_2 IS NOT NULL
            AND s1.linear_name_full ILIKE '%' || r.intersection_street_1 || '%'
            AND s2.linear_name_full ILIKE '%' || r.intersection_street_2 || '%'
          ORDER BY s1.geometry <-> s2.geometry
          LIMIT 1
        ) AS geom
      FROM requests_311 r
      WHERE r.geometry IS NULL
        AND r.intersection_street_1 IS NOT NULL
        AND TRIM(r.intersection_street_1) <> ''
        AND r.intersection_street_2 IS NOT NULL
        AND TRIM(r.intersection_street_2) <> ''
    ),
    updated AS (
      UPDATE requests_311 r
      SET geometry = c.geom,
          updated_at = now()
      FROM candidates c
      WHERE r.id = c.id AND c.geom IS NOT NULL
      RETURNING r.id
    )
    SELECT COUNT(*)::text AS count FROM updated
    `,
  );
  return Number.parseInt(rows[0]?.count ?? "0", 10);
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

export async function refreshSegmentStats(client: pg.PoolClient): Promise<number> {
  await client.query(`TRUNCATE segment_stats`);
  const { rowCount } = await client.query(
    `
    INSERT INTO segment_stats (segment_id, collision_count, protection_level, gap_score, dead_end_protected)
    SELECT
      s.id,
      COALESCE(c.cnt, 0),
      COALESCE(b.best_level, 'none'::protection_level),
      COALESCE(c.cnt, 0) * 10
        + CASE COALESCE(b.best_level, 'none'::protection_level)
            WHEN 'none'::protection_level THEN 5
            WHEN 'shared'::protection_level THEN 3
            WHEN 'painted'::protection_level THEN 2
            ELSE 0
          END,
      false
    FROM street_segments s
    LEFT JOIN (
      SELECT nearest_segment_id AS segment_id, COUNT(*)::int AS cnt
      FROM collisions
      WHERE nearest_segment_id IS NOT NULL
      GROUP BY nearest_segment_id
    ) c ON c.segment_id = s.id
    LEFT JOIN LATERAL (
      SELECT CASE MAX(
        CASE bi.protection_level
          WHEN 'protected' THEN 3
          WHEN 'painted' THEN 2
          WHEN 'shared' THEN 1
          ELSE 0
        END
      )
        WHEN 3 THEN 'protected'::protection_level
        WHEN 2 THEN 'painted'::protection_level
        WHEN 1 THEN 'shared'::protection_level
        ELSE 'none'::protection_level
      END AS best_level
      FROM bike_infrastructure bi
      WHERE ST_DWithin(bi.geometry::geography, s.geometry::geography, 25)
    ) b ON true
    `,
  );
  return rowCount ?? 0;
}
