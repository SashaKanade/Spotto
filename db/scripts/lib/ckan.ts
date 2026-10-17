import { CKAN_BASE } from "./config.js";

export type CkanResource = {
  id: string;
  name: string;
  format: string;
  url: string;
  datastore_active?: boolean;
};

export type DatastoreField = {
  id: string;
  type: string;
};

type PackageShowResult = {
  success: boolean;
  result: {
    name: string;
    title: string;
    resources: CkanResource[];
  };
};

type DatastoreSearchResult = {
  success: boolean;
  result: {
    total: number;
    fields: DatastoreField[];
    records: Record<string, unknown>[];
  };
};

async function ckanGet<T>(action: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${CKAN_BASE}/${action}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`CKAN ${action} failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { success: boolean; error?: unknown };
  if (!body.success) {
    throw new Error(`CKAN ${action} error: ${JSON.stringify(body)}`);
  }
  return body as T;
}

export async function packageShow(packageId: string): Promise<PackageShowResult["result"]> {
  const body = await ckanGet<PackageShowResult>("package_show", { id: packageId });
  return body.result;
}

/** Prefer active GeoJSON datastore resource in EPSG:4326; else active CSV datastore. */
export function pickDatastoreResource(resources: CkanResource[]): CkanResource {
  const active = resources.filter((r) => r.datastore_active);
  const geo = active.find(
    (r) => r.format.toLowerCase() === "geojson" && /4326|centreline|cycling|ward/i.test(r.name),
  );
  if (geo) return geo;
  const csv = active.find((r) => r.format.toUpperCase() === "CSV");
  if (csv) return csv;
  if (active[0]) return active[0];
  throw new Error("No datastore-active resource found on package");
}

export async function datastoreFields(resourceId: string): Promise<DatastoreField[]> {
  const body = await ckanGet<DatastoreSearchResult>("datastore_search", {
    resource_id: resourceId,
    limit: "0",
  });
  return body.result.fields.filter((f) => f.id !== "_id");
}

export async function* datastoreRecords(
  resourceId: string,
  options?: { filters?: Record<string, string>; pageSize?: number },
): AsyncGenerator<Record<string, unknown>[]> {
  const pageSize = options?.pageSize ?? 5000;
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const params: Record<string, string> = {
      resource_id: resourceId,
      limit: String(pageSize),
      offset: String(offset),
    };
    if (options?.filters) {
      params.filters = JSON.stringify(options.filters);
    }
    const body = await ckanGet<DatastoreSearchResult>("datastore_search", params);
    total = body.result.total;
    const batch = body.result.records;
    if (batch.length === 0) break;
    yield batch;
    offset += batch.length;
  }
}

/** Yearly 311 ZIP resources (not datastore). */
export function pick311YearResources(
  resources: CkanResource[],
  years: readonly number[],
): CkanResource[] {
  const picked: CkanResource[] = [];
  for (const year of years) {
    const match = resources.find(
      (r) =>
        r.format.toUpperCase() === "ZIP" &&
        r.name.includes(String(year)) &&
        r.name.toLowerCase().includes("service requests"),
    );
    if (!match) {
      throw new Error(`311 ZIP resource not found for year ${year}`);
    }
    picked.push(match);
  }
  return picked;
}

export function resourceSourceUrl(resource: CkanResource, packageId: string): string {
  return resource.url || `${CKAN_BASE.replace("/api/3/action", "")}/dataset/${packageId}/resource/${resource.id}`;
}
