-- Gap engine: single source of truth for segment_stats (called from ingestion and manually).

CREATE OR REPLACE FUNCTION protection_penalty(level protection_level)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE level
    WHEN 'none' THEN 5
    WHEN 'shared' THEN 3
    WHEN 'painted' THEN 2
    WHEN 'protected' THEN 0
  END;
$$;

CREATE OR REPLACE FUNCTION compute_gap_score(
  collision_count integer,
  level protection_level,
  dead_end boolean
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (GREATEST(collision_count, 0) * 10.0)
       + protection_penalty(level)
       + CASE WHEN dead_end THEN 4.0 ELSE 0.0 END;
$$;

CREATE OR REPLACE FUNCTION refresh_segment_stats()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  inserted integer;
BEGIN
  TRUNCATE segment_stats;

  WITH collision_counts AS (
    SELECT nearest_segment_id AS segment_id, COUNT(*)::int AS cnt
    FROM collisions
    WHERE nearest_segment_id IS NOT NULL
    GROUP BY nearest_segment_id
  ),
  segment_protection AS (
    SELECT
      s.id AS segment_id,
      CASE MAX(
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
    FROM street_segments s
    LEFT JOIN bike_infrastructure bi
      ON bi.geometry && ST_Expand(s.geometry, 0.00025)
     AND ST_DWithin(bi.geometry, s.geometry, 0.00025)
    GROUP BY s.id
  ),
  dead_ends AS (
    SELECT DISTINCT s.id AS segment_id
    FROM street_segments s
    INNER JOIN segment_protection sp ON sp.segment_id = s.id AND sp.best_level = 'protected'
    CROSS JOIN LATERAL (
      SELECT ST_StartPoint(s.geometry) AS pt
      UNION ALL
      SELECT ST_EndPoint(s.geometry)
    ) endpoints
    INNER JOIN LATERAL (
      SELECT s2.id
      FROM street_segments s2
      LEFT JOIN segment_protection sp2 ON sp2.segment_id = s2.id
      WHERE s2.id <> s.id
        AND s2.geometry && ST_Expand(endpoints.pt, 0.0002)
        AND ST_DWithin(s2.geometry, endpoints.pt, 0.0002)
        AND COALESCE(sp2.best_level, 'none'::protection_level) <> 'protected'::protection_level
    ) nearby_unprotected ON true
  ),
  assembled AS (
    SELECT
      s.id AS segment_id,
      COALESCE(c.cnt, 0) AS collision_count,
      COALESCE(sp.best_level, 'none'::protection_level) AS protection_level,
      EXISTS (SELECT 1 FROM dead_ends d WHERE d.segment_id = s.id) AS dead_end_protected
    FROM street_segments s
    LEFT JOIN collision_counts c ON c.segment_id = s.id
    LEFT JOIN segment_protection sp ON sp.segment_id = s.id
  )
  INSERT INTO segment_stats (
    segment_id, collision_count, protection_level, gap_score, dead_end_protected, computed_at
  )
  SELECT
    segment_id,
    collision_count,
    protection_level,
    compute_gap_score(collision_count, protection_level, dead_end_protected),
    dead_end_protected,
    now()
  FROM assembled;

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;

COMMENT ON FUNCTION compute_gap_score IS
  'gap_score = (cyclist_KSI_count × 10) + protection_penalty + (4 if protected infra dead-ends into lower protection within 20 m)';

COMMENT ON FUNCTION refresh_segment_stats IS
  'Rebuilds segment_stats: KSI counts from snapped collisions, protection from bike infra within 25 m, dead-end flags at protected endpoints.';
