# Safe Streets TO

Civic data platform for Toronto's 2026 municipal election. It shows where cyclists are killed or seriously injured, what bike infrastructure exists there, and what residents can do about it. It must be strictly nonpartisan: never rank, praise, or criticize councillors or candidates, never predict the election, never recommend a vote.

## Stack
- Monorepo: /api (Node + Express + TypeScript), /web (React + Vite + TypeScript), /db (SQL + ingestion scripts)
- Database: PostgreSQL with PostGIS (hosted on Supabase). Use the `pg` package with a DATABASE_URL from .env
- Map: MapLibre GL JS (react-map-gl) with a free basemap, deck.gl for heatmap/hexbin layers
- Charts: Recharts
- AI: Anthropic API, called only from the backend. Key in ANTHROPIC_API_KEY in .env
- Never commit .env. Provide .env.example.

## Data (Toronto Open Data Portal, CKAN API at https://ckan0.cf.opendata.inter.prod-toronto.ca)
Do NOT hardcode download URLs. Write the ingestion to call `/api/3/action/package_show?id=<package-id>`, find the right resource (GeoJSON or CSV, datastore-active if available), and download it. Datasets:
1. Killed or seriously injured collisions (KSI). Filter to cyclist-involved rows
2. Cycling Network (with infrastructure type)
3. City wards (25 wards)
4. Toronto Centreline (street segments)
5. 311 service requests (bike-related types only, recent years only, because the files are large)
6. Traffic volumes (optional, phase 4)
Before writing the schema, inspect each file's real columns and print a summary. If a package id or column name is wrong, tell me instead of guessing.

## Database schema (PostGIS, SRID 4326)
Tables: wards, street_segments, bike_infrastructure (with a normalized protection_level: protected / painted / shared / none), collisions (cyclist KSI only: date, year, location geometry, ward_id, nearest_segment_id), requests_311 (type, status, opened, closed, geometry, ward_id), segment_stats (collision_count, protection_level, gap_score). Add GIST indexes on every geometry column. Add an `ingest_log` table recording dataset name, source URL, row count, and refreshed_at.

## Features
1. Map: toggles for collisions, bike lanes (colored by protection level), 311 reports, gap heatmap. Click a point or segment for details.
2. Gap engine: for each street segment, compute a gap score combining cyclist KSI count and protection level (more collisions + less protection = higher score). Also flag where protected lanes dead-end into unprotected streets. Document the formula on a Methodology page. Output a ranked top-20 corridors list.
3. Ward pages (all 25): cyclist KSI by year, km of protected lanes, share of ward collisions within 100 m of a protected lane, 311 bike complaints and median days to close. Descriptive only.
4. Action tools: (a) click a location, get a pre-filled 311 report text plus a link to the City's 311 page, (b) a message generator that cites local data ("Within 300 m of this intersection there were N reported cyclist KSI collisions since YYYY") that the user can copy to send to their councillor, (c) the same neutral "questions to ask candidates" list for every ward.
5. AI layer: POST /api/ask accepts a question. Claude must answer ONLY by calling predefined, parameterized tools (get_ward_summary, get_top_corridors, get_collisions_near_point, compare_wards). Never let the model write raw SQL. Return the answer plus the numbers used. System prompt: no endorsements, no predictions, no speculation beyond the data, say "the data doesn't show that" when needed. Also POST /api/ward/:id/briefing returns a plain-language summary written from computed stats only, with an optional `lang` parameter.
6. Exports: CSV and GeoJSON for any ward or view, plus shareable URLs for map state.

## Required honesty on the site
- Show "data last refreshed" from ingest_log
- State that collision data covers only police-reported KSI incidents, locations may be generalized, and near-misses are not included
- Cite every dataset with its Open Data Portal link and licence
- A visible Methodology page

## Quality rules
- Cache expensive queries; precompute gap scores in the ingestion step
- Validate all API inputs; parameterized SQL only
- Responsive layout, accessible colors (colorblind-safe), plain language
- Write a README with setup and run instructions, plus scripts: `npm run db:migrate`, `npm run ingest`, `npm run dev`