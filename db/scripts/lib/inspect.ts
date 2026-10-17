import type { DatastoreField } from "./ckan.js";

export function printColumnSummary(
  datasetLabel: string,
  fields: DatastoreField[],
  sampleRows?: Record<string, unknown>[],
): void {
  console.log(`\n=== ${datasetLabel} — columns (${fields.length}) ===`);
  console.table(
    fields.map((f) => ({
      column: f.id,
      type: f.type,
    })),
  );

  if (sampleRows && sampleRows.length > 0) {
    console.log(`Sample row keys (first record):`);
    const row = sampleRows[0];
    const preview: Record<string, string> = {};
    for (const f of fields.slice(0, 12)) {
      const v = row[f.id];
      if (v === null || v === undefined) preview[f.id] = String(v);
      else if (f.id === "geometry") preview[f.id] = typeof v === "string" ? `${v.slice(0, 40)}…` : "[object]";
      else preview[f.id] = String(v).slice(0, 60);
    }
    console.table(preview);
  }
}

export function csvHeaderSummary(datasetLabel: string, headers: string[]): void {
  console.log(`\n=== ${datasetLabel} — CSV columns (${headers.length}) ===`);
  console.table(headers.map((h) => ({ column: h })));
}
