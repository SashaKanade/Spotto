# Open Data → schema mapping (for ingestion)

Verified against Toronto CKAN datastore / sample files (2026-10). Ingestion must resolve download URLs via `package_show`, not hardcoded links.

| Dataset | Package ID | Key source columns |
|---------|------------|-------------------|
| City Wards | `5e7a8234-f805-43ac-820f-03d7c360b588` | `AREA_ID`, `AREA_SHORT_CODE` (ward number), `AREA_NAME`, `geometry`, `OBJECTID` |
| Toronto Centreline | `1d079757-377b-4564-82df-eb5638583bfb` | `CENTRELINE_ID`, `LINEAR_NAME_FULL`, `FEATURE_CODE`, `geometry`, … |
| Cycling Network | `abbe5ee3-e249-4f86-a219-f0022eaddcc9` | `SEGMENT_ID`, `INFRA_HIGHORDER`, `INFRA_LOWORDER`, `STREET_NAME`, `SHAPE_LENGTH`, `geometry` |
| Motor Vehicle KSI | `73a8e475-9683-42e1-ac06-b8690dcba062` | `collision_id`, `accdate`, `injury`, `cyclist`, `longitude`, `latitude`, `geometry`, `wardname`, `stname1`, `stname2`, `per_no` — filter `cyclist` for cyclist-involved rows |
| 311 Service Requests | `2e54bc0e-4399-4076-b717-351df5918ae7` | Yearly ZIP → `SR{YYYY}.csv`: `Creation Date`, `Status`, `Service Request Type`, `Ward`, intersection fields, `Division`, `Section` — no geometry in CSV |

**Notes**

- Ward table expects 25 rows (`AREA_TYPE` = CITW in current release).
- 311 `closed_at` may require parsing from `Status` or future City fields; confirm when building ingestion.
- `protection_level` is derived from `INFRA_HIGHORDER` / `INFRA_LOWORDER` during ingest.
