# Deploy Safe Streets TO with Vercel and Render

This setup serves the React/Vite site from Vercel and the Express API from Render. PostgreSQL with PostGIS must be reachable by the Render API service. Keep secrets in the hosting dashboards; never commit `.env`.

## 1. Prepare the database

Create a PostgreSQL database with PostGIS enabled. Copy its connection string for the API's `DATABASE_URL`. The API host must be allowed to connect to the database; use the provider's internal connection string when the API and database share a private network.

Apply schema migrations once against that database from a trusted machine with Node.js 20+:

```sh
npm ci
DATABASE_URL="postgresql://…" npm run db:migrate
```

Load source data after migrations:

```sh
DATABASE_URL="postgresql://…" npm run ingest
```

Ingestion uses Toronto Open Data. Review its output and the `ingest_log` table before announcing the site as current.

## 2. Deploy the API on Render

Create a **Web Service** connected to the repository.

| Setting | Value |
|---|---|
| Root Directory | repository root (blank) |
| Runtime | Node |
| Build Command | `npm ci && npm run build -w api` |
| Start Command | `npm run start -w api` |
| Health Check Path | `/api/health` |

Set these environment variables in Render:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Postgres connection string, including SSL options required by the provider |
| `CORS_ORIGIN` | Comma-separated allowed origins, for example `https://safe-streets-to.vercel.app,https://safe-streets-to-git-main.example.vercel.app` |
| `ANTHROPIC_API_KEY` | Optional; required only for `/api/ask` |
| `NODE_VERSION` | `20` or a newer supported Node.js 20 release |

Render supplies `PORT` automatically. After deployment, check `https://<render-service>.onrender.com/api/health` and confirm it returns `ok: true`.

## 3. Deploy the site on Vercel

Import the same repository as a Vercel project. Use these project settings:

| Setting | Value |
|---|---|
| Root Directory | `.` (repository root) |
| Framework Preset | Vite |
| Build Command | `npm run build -w web` |
| Output Directory | `web/dist` |
| Install Command | `npm ci` |

Set this environment variable for Production and Preview deployments:

| Variable | Value |
|---|---|
| `VITE_API_BASE` | The Render service origin, for example `https://safe-streets-api.onrender.com` (no trailing slash) |

The browser calls the API origin directly. Add each Vercel deployment origin that should access the API to Render's comma-separated `CORS_ORIGIN` value. Redeploy the API after changing `CORS_ORIGIN`, and redeploy the site after changing `VITE_API_BASE`.

## 4. Verify the deployment

1. Open the Vercel site and check that the map, ward list, and refreshed-date label load.
2. Open a ward and create its briefing.
3. Download a GeoJSON and CSV export for a ward and for the current view.
4. Copy the map link, open it in a private window, and confirm its view, layer toggles, and selected ward are restored.
5. If configured, submit a basic question to `/api/ask` and confirm it returns tool-backed values.

Exports are capped at 50,000 rows per request. Collision records represent police-reported KSI incidents only; locations can be generalized and near-misses are not included. Keep dataset links, licences, and the on-page methodology available when publishing derived data.

## Operations notes

- For schema changes, deploy the API code and run `npm run db:migrate` against the production database as a release step before directing traffic to code that requires the new schema.
- Refresh datasets on a deliberate schedule using a trusted job runner. Do not put database credentials in Vercel client variables; variables prefixed with `VITE_` are public in the browser bundle.
- The map basemap style is provided by a public style URL and can have its own availability or usage limits.
- The in-memory API cache resets when the Render service restarts and is not shared across multiple instances.
