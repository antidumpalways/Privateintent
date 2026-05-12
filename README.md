# PrivateIntent

Welcome to **PrivateIntent** — a privacy-first intent-based application framework.

## Monorepo Structure

| Path | Description |
|------|-------------|
| `artifacts/api-server/` | API server |
| `artifacts/mockup-sandbox/` | Mockup sandbox environment |
| `artifacts/pitch-deck/` | Pitch deck materials |
| `artifacts/prism-dwallet-web/` | Prism DWallet web interface |
| `lib/api-client-react/` | React API client library |
| `lib/api-spec/` | API specification |
| `lib/api-zod/` | Zod validation schemas |
| `lib/db/` | Database library |
| `lib/integrations/` | Integrations |
| `lib/integrations-anthropic-ai/` | Anthropic AI integration |
| `scripts/` | Build & utility scripts |

## Getting Started

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build
```

## Tech Stack

- **Runtime:** Node.js
- **Package Manager:** pnpm (workspaces)
- **Language:** TypeScript
- **Formatting:** Prettier