/** Parse CKAN datastore geometry (GeoJSON string or object) for ST_GeomFromGeoJSON. */
export function geometryGeoJson(record: Record<string, unknown>): string | null {
  const raw = record.geometry;
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  return JSON.stringify(raw);
}

export function parseWardNumberFrom311(wardField: string | null | undefined): number | null {
  if (!wardField) return null;
  const wardLabel = wardField.match(/\bward\s*(\d{1,2})\b/i);
  if (wardLabel) return Number.parseInt(wardLabel[1], 10);
  const m = wardField.match(/\((\d{1,2})\)\s*$/);
  if (m) return Number.parseInt(m[1], 10);
  const m2 = wardField.match(/^(\d{1,2})\s*-/);
  if (m2) return Number.parseInt(m2[1], 10);
  return null;
}
