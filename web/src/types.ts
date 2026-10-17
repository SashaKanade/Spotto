import type { Feature, FeatureCollection, Geometry } from "geojson";

export type ProtectionLevel = "protected" | "painted" | "shared" | "none";

export interface WardProps {
  ward_number: number;
  name: string;
  ksi_total: number;
  km_protected: number;
}

export interface CollisionProps {
  id: number;
  collision_id: string;
  occurred_on: string;
  year: number;
  injury: string | null;
  stname1: string | null;
  stname2: string | null;
  ward_number: number | null;
}

export interface BikeLaneProps {
  id: number;
  street_name: string | null;
  from_street: string | null;
  to_street: string | null;
  infra_highorder: string;
  infra_loworder: string | null;
  protection_level: ProtectionLevel;
  installed_year: number | null;
}

export interface HotspotProps {
  rank: number;
  id: number;
  street_name: string | null;
  length_m: number | null;
  collision_count: number;
  protection_level: ProtectionLevel;
  gap_score: number;
  dead_end_protected: boolean;
}

export type ApiFeatureCollection<P> = FeatureCollection<Geometry, P> & {
  meta?: { count: number; truncated?: boolean; note?: string };
};
export type ApiFeature<P> = Feature<Geometry, P>;

export interface WardDetail {
  ward_number: number;
  name: string;
  bbox: [number, number, number, number];
  ksi_by_year: { year: number; count: number }[];
  ksi_total: number;
  km_by_protection: { protected: number; painted: number; shared: number };
  ksi_near_protected_lane: { total: number; within_100m: number; share: number | null };
  requests_311: {
    total: number;
    closed: number;
    median_days_to_close: number | null;
    first_year: number | null;
    last_year: number | null;
  };
}

export interface Meta {
  last_refreshed: string | null;
  datasets: { dataset_name: string; source_url: string; row_count: number; refreshed_at: string }[];
  caveats: string[];
}

export interface LayerToggles {
  collisions: boolean;
  bikeLanes: boolean;
  hotspots: boolean;
  gapHeatmap: boolean;
}

export interface GapHeatmapPoint {
  coordinates: [number, number];
  weight: number;
  segment_id: number;
}

export interface GapHeatmapProps {
  segment_id: number;
  gap_score: number;
  collision_count: number;
  protection_level: ProtectionLevel;
  weight: number;
}
