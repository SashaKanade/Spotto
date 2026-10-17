/**
 * Print real CKAN / CSV columns for each dataset (no database required).
 * Usage: npm run inspect -w db
 */
import {
  datastoreFields,
  datastoreRecords,
  packageShow,
  pick311YearResources,
  pickDatastoreResource,
} from "./lib/ckan.js";
import { PACKAGES, REQUESTS_311_YEARS } from "./lib/config.js";
import { csvHeaderSummary, printColumnSummary } from "./lib/inspect.js";
import { protectionFromInfraHigh } from "./lib/protection.js";
import unzipper from "unzipper";

async function inspect311(): Promise<void> {
  const pkg = await packageShow(PACKAGES.requests311);
  console.log("311 yearly resources:", pkg.resources.filter((r) => r.format.toUpperCase() === "ZIP").map((r) => r.name).join(", "));
  const resources = pick311YearResources(pkg.resources, [REQUESTS_311_YEARS[0]]);
  const resource = resources[0];
  const res = await fetch(resource.url);
  const buf = Buffer.from(await res.arrayBuffer());
  const directory = await unzipper.Open.buffer(buf);
  const csvEntry = directory.files.find((f) => f.path.toLowerCase().endsWith(".csv"));
  if (!csvEntry) throw new Error("No CSV in 311 ZIP");
  const content = (await csvEntry.buffer()).toString("utf8");
  const headerLine = content.split("\n")[0];
  csvHeaderSummary(`311 Service Requests (${resource.name})`, headerLine.split(","));
}

async function inspectDatastore(packageId: string, label: string, filters?: Record<string, string>): Promise<void> {
  const pkg = await packageShow(packageId);
  const resource = pickDatastoreResource(pkg.resources);
  const fields = await datastoreFields(resource.id);
  const batch =
    (await datastoreRecords(resource.id, { pageSize: 2, filters }).next()).value ?? [];
  printColumnSummary(`${label} (${pkg.title})`, fields, batch);
}

async function inspectCyclingMapping(): Promise<void> {
  const pkg = await packageShow(PACKAGES.cyclingNetwork);
  const resource = pickDatastoreResource(pkg.resources);
  const values = new Set<string>();
  for await (const batch of datastoreRecords(resource.id)) {
    for (const row of batch) {
      if (row.INFRA_HIGHORDER) values.add(String(row.INFRA_HIGHORDER));
    }
  }
  console.log("\n=== Cycling Network — protection_level mapping ===");
  console.table(
    [...values].sort().map((v) => ({
      INFRA_HIGHORDER: v,
      protection_level: protectionFromInfraHigh(v),
    })),
  );
}

async function main(): Promise<void> {
  await inspectDatastore(PACKAGES.wards, "Wards");
  await inspectDatastore(PACKAGES.centreline, "Toronto Centreline");
  await inspectDatastore(PACKAGES.cyclingNetwork, "Cycling Network");
  await inspectCyclingMapping();
  await inspectDatastore(PACKAGES.ksiCollisions, "Cyclist KSI", { road_user: "cyclist" });
  await inspect311();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
