# Local Setup for Private Intent

This project supports running fully locally using Docker for PostgreSQL and `pnpm` for the monorepo.

## Prerequisites

- Node.js 20+
- pnpm 9+
- Docker Desktop (or Docker Engine with compose support)
- Git

## 1. Start local PostgreSQL

From the repository root:

```bash
docker compose up -d postgres
```

Verify the DB is running:

```bash
docker compose ps
```

## 2. Configure local environment

Update `.env` to use the local Docker Postgres database.

Example:

```env
DATABASE_URL=postgresql://privateintent:privateintent123@localhost:5432/privateintent
```

Make sure the following values are set correctly:

```env
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=privateintent
POSTGRES_USER=privateintent
POSTGRES_PASSWORD=privateintent123
```

If you already have `.env`, just change the `DATABASE_URL` line as shown above.

## 3. Install dependencies

```bash
pnpm install
```

## 4. Build the API server

```bash
pnpm --filter @workspace/api-server exec -- node build.mjs
```

## 5. Seed demo data (optional)

```bash
pnpm --filter @workspace/api-server run seed
```

This prepares demo data for the API, including a sample dWallet and audit entries.

## 6. Start the API server

```bash
pnpm --filter @workspace/api-server exec -- node --enable-source-maps dist/index.mjs
```

The server should listen on port `8080` by default.

## 7. Start the frontend

In a second terminal:

```bash
pnpm --filter @workspace/prism-dwallet-web exec -- vite --config vite.config.ts --host 0.0.0.0
```

The web UI will be available at `http://localhost:5173`.

## 8. Verify the stack

Check the API health endpoint:

```bash
curl http://localhost:8080/api/healthz
```

Expected output:

```json
{"status":"ok"}
```

## Notes

- The project uses the local Docker Postgres database defined in `docker-compose.yml`.
- `DATABASE_URL` is the only database connection string used by the backend.
- If Docker is not available, you can also run a local PostgreSQL instance on `localhost:5432`.
- This guide assumes you are running the API and frontend locally in separate terminals.
