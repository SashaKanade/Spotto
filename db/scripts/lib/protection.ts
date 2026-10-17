export type ProtectionLevel = "protected" | "painted" | "shared" | "none";

/** Most specific labels first (longest match wins). */
const RULES: { match: string; level: ProtectionLevel }[] = [
  { match: "multi-use trail - entrance", level: "shared" },
  { match: "bi-directional cycle track", level: "protected" },
  { match: "bike lane - buffered", level: "protected" },
  { match: "bike lane - contraflow", level: "painted" },
  { match: "cycle track - contraflow", level: "painted" },
  { match: "cycle track", level: "protected" },
  { match: "bike lane", level: "painted" },
  { match: "multi-use trail", level: "protected" },
  { match: "sharrows - wayfinding", level: "shared" },
  { match: "sharrows - arterial - connector", level: "shared" },
  { match: "sharrows - arterial", level: "shared" },
  { match: "sharrows", level: "shared" },
  { match: "signed route (no pavement markings)", level: "shared" },
  { match: "park road", level: "shared" },
];

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Map Toronto Cycling Network INFRA_* labels to normalized protection_level.
 * Uses INFRA_HIGHORDER (highest comfort on the segment).
 */
export function protectionFromInfraHigh(infraHigh: string | null | undefined): ProtectionLevel {
  if (!infraHigh || !infraHigh.trim() || infraHigh === "<Null>") return "none";
  const key = norm(infraHigh);
  for (const { match, level } of RULES) {
    if (key === match || key.startsWith(`${match} `)) return level;
  }
  return "none";
}

/** Rank for comparing protection on a segment (higher = better). */
export function protectionRank(level: ProtectionLevel): number {
  switch (level) {
    case "protected":
      return 3;
    case "painted":
      return 2;
    case "shared":
      return 1;
    default:
      return 0;
  }
}
