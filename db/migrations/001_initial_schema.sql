-- Safe Streets TO — initial schema (EPSG:4326)
-- Source field names documented in db/migrations/SOURCE_COLUMNS.md for ingestion mapping.

CREATE EXTENSION IF NOT EXISTS postgis;

-- Normalized protection levels for bike infrastructure (derived from INFRA_HIGHORDER / INFRA_LOWORDER).
CREATE TYPE protection_level AS ENUM (
  'protected',
  'painted',
  'shared',
  'none'
);

-- ---------------------------------------------------------------------------
-- wards (Toronto Open Data: city-wards, package 5e7a8234-f805-43ac-820f-03d7c360b588)
-- ---------------------------------------------------------------------------
CREATE TABLE wards (
  id              SERIAL PRIMARY KEY,
  area_id         INTEGER NOT NULL UNIQUE,
  ward_number     SMALLINT NOT NULL UNIQUE CHECK (ward_number BETWEEN 1 AND 25),
  name            TEXT NOT NULL,
  geometry        GEOMETRY(MULTIPOLYGON, 4326) NOT NULL,
  source_objectid BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wards_geometry ON wards USING GIST (geometry);

-- ---------------------------------------------------------------------------
-- street_segments (Toronto Centreline TCL, package 1d079757-377b-4564-82df-eb5638583bfb)
-- ---------------------------------------------------------------------------
CREATE TABLE street_segments (
  id                   SERIAL PRIMARY KEY,
  centreline_id        BIGINT NOT NULL UNIQUE,
  linear_name_full     TEXT,
  feature_code         TEXT,
  feature_code_desc    TEXT,
  oneway_dir_code_desc TEXT,
  jurisdiction         TEXT,
  centreline_status    TEXT,
  length_m             DOUBLE PRECISION,
  geometry             GEOMETRY(LINESTRING, 4326) NOT NULL,
  source_objectid      BIGINT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_street_segments_geometry ON street_segments USING GIST (geometry);
CREATE INDEX idx_street_segments_linear_name ON street_segments (linear_name_full);

-- ---------------------------------------------------------------------------
-- bike_infrastructure (Cycling Network, package abbe5ee3-e249-4f86-a219-f0022eaddcc9)
-- ---------------------------------------------------------------------------
CREATE TABLE bike_infrastructure (
  id                  SERIAL PRIMARY KEY,
  segment_id          TEXT,
  street_name         TEXT,
  from_street         TEXT,
  to_street           TEXT,
  infra_highorder     TEXT NOT NULL,
  infra_loworder      TEXT,
  protection_level    protection_level NOT NULL,
  installed_year      SMALLINT,
  upgraded_year       SMALLINT,
  shape_length_m      DOUBLE PRECISION,
  geometry            GEOMETRY(MULTILINESTRING, 4326) NOT NULL,
  nearest_segment_id  INTEGER REFERENCES street_segments (id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bike_infrastructure_geometry ON bike_infrastructure USING GIST (geometry);
CREATE INDEX idx_bike_infrastructure_protection ON bike_infrastructure (protection_level);
CREATE INDEX idx_bike_infrastructure_nearest_segment ON bike_infrastructure (nearest_segment_id);

-- ---------------------------------------------------------------------------
-- collisions — cyclist KSI only (Motor Vehicle KSI, package 73a8e475-9683-42e1-ac06-b8690dcba062)
-- One row per collision event (dedupe by collision_id + cyclist involvement).
-- ---------------------------------------------------------------------------
CREATE TABLE collisions (
  id                   SERIAL PRIMARY KEY,
  collision_id         BIGINT NOT NULL,
  occurred_on          DATE NOT NULL,
  year                 SMALLINT NOT NULL,
  injury               TEXT,
  stname1              TEXT,
  stname2              TEXT,
  ward_name            TEXT,
  ward_id              INTEGER REFERENCES wards (id) ON DELETE SET NULL,
  nearest_segment_id   INTEGER REFERENCES street_segments (id) ON DELETE SET NULL,
  longitude            DOUBLE PRECISION,
  latitude             DOUBLE PRECISION,
  location             GEOMETRY(POINT, 4326) NOT NULL,
  source_per_no        INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (collision_id, source_per_no)
);

CREATE INDEX idx_collisions_geometry ON collisions USING GIST (location);
CREATE INDEX idx_collisions_year ON collisions (year);
CREATE INDEX idx_collisions_ward_id ON collisions (ward_id);
CREATE INDEX idx_collisions_nearest_segment ON collisions (nearest_segment_id);

-- ---------------------------------------------------------------------------
-- requests_311 (311 Service Requests, package 2e54bc0e-4399-4076-b717-351df5918ae7)
-- Yearly ZIP/CSV; geometry filled during ingestion (geocode / join to centreline).
-- ---------------------------------------------------------------------------
CREATE TABLE requests_311 (
  id                    SERIAL PRIMARY KEY,
  external_id           TEXT,
  request_type          TEXT NOT NULL,
  status                TEXT,
  opened_at             TIMESTAMPTZ NOT NULL,
  closed_at             TIMESTAMPTZ,
  ward_name             TEXT,
  ward_id               INTEGER REFERENCES wards (id) ON DELETE SET NULL,
  intersection_street_1 TEXT,
  intersection_street_2 TEXT,
  postal_prefix         TEXT,
  division              TEXT,
  section               TEXT,
  geometry              GEOMETRY(POINT, 4326),
  source_year           SMALLINT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_requests_311_geometry ON requests_311 USING GIST (geometry);
CREATE INDEX idx_requests_311_opened_at ON requests_311 (opened_at);
CREATE INDEX idx_requests_311_ward_id ON requests_311 (ward_id);
CREATE INDEX idx_requests_311_request_type ON requests_311 (request_type);

-- ---------------------------------------------------------------------------
-- segment_stats — precomputed during ingestion (gap engine inputs)
-- ---------------------------------------------------------------------------
CREATE TABLE segment_stats (
  segment_id          INTEGER PRIMARY KEY REFERENCES street_segments (id) ON DELETE CASCADE,
  collision_count     INTEGER NOT NULL DEFAULT 0 CHECK (collision_count >= 0),
  protection_level    protection_level NOT NULL DEFAULT 'none',
  gap_score           DOUBLE PRECISION NOT NULL DEFAULT 0,
  dead_end_protected  BOOLEAN NOT NULL DEFAULT false,
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_segment_stats_gap_score ON segment_stats (gap_score DESC);

-- ---------------------------------------------------------------------------
-- ingest_log
-- ---------------------------------------------------------------------------
CREATE TABLE ingest_log (
  id            SERIAL PRIMARY KEY,
  dataset_name  TEXT NOT NULL,
  source_url    TEXT NOT NULL,
  row_count     INTEGER NOT NULL CHECK (row_count >= 0),
  refreshed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ingest_log_dataset ON ingest_log (dataset_name, refreshed_at DESC);
