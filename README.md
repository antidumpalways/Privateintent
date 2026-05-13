# PrivateIntent

**Privacy-first cross-chain intent settlement layer**  
Powered by Ika MPC, Encrypt FHE, and on-chain escrow on Solana + Ethereum.

## Monorepo Structure

| Path | Description |
|------|-------------|
| `artifacts/api-server/` | API server — core engine with escrow, solver, dark pool |
| `artifacts/escrow-contract/` | **Ethereum Escrow (Sepolia)** — `PrivateIntentEscrow.sol` |
| `artifacts/mockup-sandbox/` | Mockup sandbox environment |
| `artifacts/pitch-deck/` | Pitch deck materials |
| `artifacts/prism-dwallet-web/` | Prism DWallet web interface (vanilla HTML/JS) |
| `lib/api-client-react/` | React API client library |
| `lib/api-spec/` | API specification (Zod contracts) |
| `lib/api-zod/` | Zod validation schemas |
| `lib/db/` | Database library (Drizzle ORM + PostgreSQL) |
| `lib/integrations/` | General integrations |
| `lib/integrations-anthropic-ai/` | Anthropic AI integration |
| `scripts/` | Build & utility scripts |

## 🚀 Deployed Smart Contracts

### Ethereum Sepolia — `PrivateIntentEscrow.sol`
| Item | Detail |
|------|--------|
| **Contract** | `0x8b72116ca68982F3e8c40BD3B482F1d45ac8d751` |
| **TX Hash** | `0xc3c11d664dc1d90b6321acbbc5d590641bd8690dd76c090c1417b77d599f79f7` |
| **Block** | 10846917 |
| **Deployer** | `0xFe4957467b528e6E4F2712DCD3C2D4BaB2CDb6AA` |
| **Source** | `artifacts/escrow-contract/` |
| **ABI** | `artifacts/escrow-contract/build/` |

**Functions:** `createIntent`, `settleIntent`, `refundIntent`, `disputeIntent`, `getIntent`

### Solana Devnet — Anchor Program
| Item | Detail |
|------|--------|
| **Program ID** | `GJbT5jcR38MzkmsCDrVWrjq2Bvg961CUkMnvUq7naqmq` |
| **Deployer** | Hardcoded keypair (sentinel) |
| **Network** | Solana Devnet |

**Service:** `artifacts/api-server/src/services/solanaEscrowService.ts`  
**Functions:** `settleSolanaEscrow()`, `refundSolanaEscrow()`

## 🧠 Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         PrivateIntent                                    │
│         Privacy-first Cross-Chain Intent Settlement Layer                 │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────┐    ┌───────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  User     │    │  Encrypt  │    │  Ika MPC     │    │  Solver      │  │
│  │ (Phantom) │───▶│  FHE      │───▶│  Network     │───▶│  Network     │  │
│  │  Wallet   │    │  Seal     │    │  Co-sign     │    │  (AI + MM)   │  │
│  └──────────┘    └───────────┘    └──────────────┘    └──────────────┘  │
│       │                                                      ▲           │
│       │  ① Submit intent (FHE-sealed)                        │           │
│       │  ② Solvers bid blind                                 │           │
│       │  ③ User accepts → ESCROW LOCKED                      │ ⑤ Proof   │
│       ▼                                                      │           │
│  ┌───────────────────────────────────────────────────────────┘           │
│  │                                                                       │
│  │  ┌─────────────────────┐          ┌────────────────────────┐         │
│  │  │  ETH Sepolia        │          │  Solana Devnet          │         │
│  │  │  PrivateIntentEscrow│          │  Anchor Program         │         │
│  │  │  0x8b72...d751      │          │  GJbT5jc...aqmq        │         │
│  │  │                     │          │                         │         │
│  │  │  createIntent()     │          │  sentinel keypair       │         │
│  │  │  settleIntent()     │          │  SystemProgram.transfer │         │
│  │  │  refundIntent()     │          │  (settle/refund)        │         │
│  │  │  disputeIntent()    │          │                         │         │
│  │  └─────────────────────┘          └────────────────────────┘         │
│  │                                                                       │
│  └──────────────────────────── ON-CHAIN ESCROW ─────────────────────────┘│
│                                                                          │
│  ④ Solver delivers on destination chain via Ika MPC                     │
│  ⑤ Settlement: proof verified → escrow released on-chain                │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Escrow Flow

| Step | Solana | Ethereum |
|------|--------|----------|
| Lock | SOL → sentinel pubkey (SystemProgram.transfer) | ETH → escrow contract (payable) |
| Settlement | sentinel → solver (SystemProgram.transfer) | `settleIntent()` via sentinel signer |
| Refund | sentinel → user (SystemProgram.transfer) | `refundIntent()` via sentinel signer |
| Dispute | (Anchor program pending) | `disputeIntent()` via sentinel |

## 🔧 Backend Services

| Service | File | Description |
|---------|------|-------------|
| ETH Escrow | `ethEscrowService.ts` | Sepolia escrow contract integration |
| Solana Escrow | `solanaEscrowService.ts` | Devnet SOL escrow via sentinel keypair |
| Solana Broadcast | `solanaBroadcast.ts` | Memo tx broadcast to Solana devnet |
| Ika MPC | `ika.ts`, `ikaMultichain.ts` | Multi-chain MPC signing |
| Encrypt FHE | `encrypt.ts` | Fully Homomorphic Encryption |
| AI Solver | `aiSolverAgent.ts` | Claude-powered autonomous solver |
| Solver Engine | `solverEngine.ts` | Static route/price solver |
| Dark Pool MM | `botMarketMaker.ts` | Market maker bot |
| Live Rates | `liveRates.ts` | CoinGecko price feed |
| Native Signer | `nativeSigner.ts` | BTC/ETH/SOL native tx signing |

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/healthz` | Health check |
| GET | `/healthz/integrations` | Integration status |
| GET | `/api/escrow/config` | Escrow sentinel pubkey + RPC |
| POST | `/api/intent/submit` | Submit FHE-sealed intent |
| GET | `/api/intent/:id` | Get intent details |
| GET | `/api/intent/history` | Privacy-preserved intent history |
| GET | `/api/intent/solvers` | List available solvers |
| POST | `/api/intent/accept` | Accept solver bid → lock escrow |
| POST | `/api/intent/settle` | Post delivery proof → release escrow |
| POST | `/api/darkpool/order` | Create dark pool order |
| GET | `/api/darkpool/orders` | List dark pool orders |
| POST | `/api/darkpool/match` | Match dark pool orders |
| GET | `/api/rates` | Live crypto rates |

## Getting Started

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run api-server (dev mode)
cd artifacts/api-server
pnpm dev

# API runs on http://localhost:8080
```

### Environment Variables

Copy `.env.example` → `.env` and configure:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `ESCROW_CONTRACT_ADDRESS` | ETH escrow contract (Sepolia) |
| `ETH_ESCROW_CONTRACT_ADDRESS` | Alias for above |
| `SOLANA_ESCROW_PROGRAM_ID` | Solana Anchor program ID |
| `ETHEREUM_RPC_URL` | Sepolia RPC endpoint |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Claude API key |
| `ETH_SOLVER_PRIVATE_KEY` | Solver ETH wallet PK |

## Tech Stack

- **Runtime:** Node.js
- **Package Manager:** pnpm (workspaces)
- **Language:** TypeScript
- **Framework:** Express.js
- **Database:** PostgreSQL + Drizzle ORM
- **Blockchain:** Solana Devnet + Ethereum Sepolia
- **MPC:** Ika Network (pre-alpha)
- **Privacy:** Encrypt FHE (pre-alpha)
- **AI:** Anthropic Claude