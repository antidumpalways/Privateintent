# PrivateIntent

Welcome to **PrivateIntent** — a privacy-first intent-based application framework for cross-chain swaps with AI-powered features, Ika MPC signing, and Encrypt FHE privacy.

## Monorepo Structure

| Path | Description |
|------|-------------|
| `artifacts/api-server/` | Express API server (backend) |
| `artifacts/prism-dwallet-web/` | React + Vite web frontend |
| `artifacts/mockup-sandbox/` | Mockup sandbox environment |
| `artifacts/pitch-deck/` | Pitch deck materials |
| `lib/api-client-react/` | React API client library |
| `lib/api-spec/` | API specification |
| `lib/api-zod/` | Zod validation schemas |
| `lib/db/` | Database library (Drizzle ORM) |
| `lib/integrations/` | Integrations |
| `lib/integrations-anthropic-ai/` | Anthropic AI integration |
| `scripts/` | Build & utility scripts |

## Prerequisites

- **Node.js** >= 20
- **pnpm** `npm install -g pnpm`
- **PostgreSQL** 16+ running on port 5432
- A `.env` file (copy from `.env.example`)

## Quick Start

### 1. Setup Environment

```bash
# Copy environment file
cp .env.example .env   # macOS / Linux
copy .env.example .env  # Windows

# Fill in your values (at minimum DATABASE_URL)
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Start PostgreSQL

Make sure PostgreSQL is running on `localhost:5432` with database `private_intent`:

```bash
# Windows (start service if installed via installer)
pg_ctl start -D "C:\Program Files\PostgreSQL\17\data"

# macOS (Homebrew)
brew services start postgresql

# Linux
sudo systemctl start postgresql
```

### 4. Run Backend (API Server)

The backend runs on **port 8080**:

```powershell
# PowerShell (Windows)
cd artifacts/api-server
$env:NODE_ENV="development"
$env:PORT="8080"
$env:DATABASE_URL="postgresql://postgres@localhost:5432/private_intent"
$env:AI_INTEGRATIONS_ANTHROPIC_API_KEY="your-anthropic-key"
$env:ETH_SOLVER_PRIVATE_KEY="0x..."
node ./build.mjs          # Build with esbuild
node --enable-source-maps ./dist/index.mjs   # Start server
```

```bash
# Bash (macOS / Linux)
cd artifacts/api-server
export NODE_ENV=development
export PORT=8080
export DATABASE_URL="postgresql://postgres@localhost:5432/private_intent"
pnpm run build && pnpm run start
```

### 5. Run Frontend (Prism DWallet Web)

Open a new terminal. The frontend runs on **port 5173** and proxies `/api` to the backend:

```powershell
# PowerShell (Windows)
cd artifacts/prism-dwallet-web
$env:PORT="5173"
pnpm run dev
```

```bash
# Bash (macOS / Linux)
cd artifacts/prism-dwallet-web
PORT=5173 pnpm run dev
```

### 6. Open in Browser

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:8080/api

## Environment Variables

See [`.env.example`](.env.example) for all variables. Minimum required:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `PORT` | API server port (default: 8080) |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Anthropic Claude API key |

## Tech Stack

- **Runtime:** Node.js
- **Package Manager:** pnpm (workspaces)
- **Language:** TypeScript
- **Backend:** Express, Drizzle ORM, esbuild
- **Frontend:** React, Vite, TailwindCSS, shadcn/ui
- **Cross-chain:** Ika MPC (gRPC), Solana Web3, Ethers.js
- **Privacy:** Encrypt FHE
- **AI:** Anthropic Claude