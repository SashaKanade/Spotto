# Safe Streets TO

Civic data platform for Toronto cycling safety and infrastructure. See [PROJECT_BRIEF.md](./PROJECT_BRIEF.md) for scope and requirements.

## Prerequisites

- Node.js 20+
- PostgreSQL with [PostGIS](https://postgis.net/) (e.g. Supabase)

## Setup

1. Copy environment variables:

   ```bash
   cp .env.example .env
   ```

   Fill in `DATABASE_URL` and, when using AI features, `ANTHROPIC_API_KEY`.

2. Install dependencies:

   ```bash
   npm install
   ```

3. Run migrations:

   ```bash
   npm run db:migrate
   ```

   Includes `002_collision_id_text.sql` (KSI IDs like `2026:6001592016` are text, not integers).

4. Preview Open Data columns (no database):

   ```bash
   npm run inspect -w db
   ```

5. Ingest open data (runs in dependency order; prints column inspection for each dataset):

   ```bash
   npm run ingest              # all datasets
   npm run ingest -- wards     # one dataset
   npm run ingest -- collisions,segment-stats
   ```

   Datasets: `wards`, `street-segments`, `bike-infrastructure`, `collisions`, `requests-311`, `segment-stats`

## Development

Start the API and web app (two processes):

```bash
npm run dev
```

- API: http://localhost:3001 (default `PORT`)
- Web: http://localhost:5173

## Monorepo layout

| Package | Path | Role |
|---------|------|------|
| `api` | `/api` | Express + TypeScript backend |
| `web` | `/web` | React + Vite frontend |
| `db` | `/db` | SQL migrations and ingestion scripts |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run db:migrate` | Apply SQL migrations in `/db/migrations` |
| `npm run inspect -w db` | Print CKAN/CSV columns from live Open Data |
| `npm run ingest` | Load datasets into PostGIS (see dataset names above) |
| `npm run dev` | Run API and web in development mode |
