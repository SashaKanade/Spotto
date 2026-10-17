import { getPool, withTransaction } from "./lib/db.js";
import { ingestBikeInfrastructure } from "./ingest/bike-infrastructure.js";
import { ingestCollisions } from "./ingest/collisions.js";
import { ingestRequests311 } from "./ingest/requests-311.js";
import { ingestStreetSegments } from "./ingest/street-segments.js";
import { ingestWards } from "./ingest/wards.js";
import { refreshSegmentStats } from "./lib/spatial.js";

const STEPS = {
  wards: { fn: ingestWards, requires: [] as string[] },
  "street-segments": { fn: ingestStreetSegments, requires: [] as string[] },
  "bike-infrastructure": {
    fn: ingestBikeInfrastructure,
    requires: ["street-segments"],
  },
  collisions: { fn: ingestCollisions, requires: ["wards", "street-segments"] },
  "requests-311": { fn: ingestRequests311, requires: ["wards", "street-segments"] },
  "segment-stats": {
    fn: async (client) => {
      const n = await refreshSegmentStats(client);
      console.log(`Segment stats: refreshed ${n} rows.`);
      return n;
    },
    requires: ["street-segments", "bike-infrastructure", "collisions"],
  },
} as const;

type StepName = keyof typeof STEPS;

const ORDER: StepName[] = [
  "wards",
  "street-segments",
  "bike-infrastructure",
  "collisions",
  "requests-311",
  "segment-stats",
];

function parseArgs(): StepName[] {
  const arg = process.argv[2] ?? "all";
  if (arg === "all") return ORDER.filter((s) => s !== "segment-stats").concat("segment-stats");
  const names = arg.split(",").map((s) => s.trim()) as StepName[];
  for (const n of names) {
    if (!(n in STEPS)) {
      console.error(`Unknown dataset "${n}". Choose: ${ORDER.join(", ")}, all`);
      process.exit(1);
    }
  }
  return names;
}

async function main(): Promise<void> {
  const selected = parseArgs();
  const pool = getPool();

  try {
    for (const step of ORDER) {
      if (!selected.includes(step)) continue;
      const { fn, requires } = STEPS[step];
      for (const req of requires) {
        if (!selected.includes(req) && process.argv[2] !== req) {
          // single-step run: user must have dependencies loaded already
          if (process.argv[2] && process.argv[2] !== "all") {
            console.warn(`Note: "${step}" expects "${req}" to already be loaded.`);
          }
        }
      }

      console.log(`\n>>> Ingest: ${step}`);
      await withTransaction(pool, async (client) => {
        await fn(client);
      });
    }
  } finally {
    await pool.end();
  }

  console.log("\nIngestion finished.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
