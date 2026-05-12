# Private Intent

**Privacy-first, bridgeless intent engine on Solana**

> Colosseum Frontier Hackathon — Ika + Encrypt Track

---

## The Problem

Cross-chain DeFi today is broken in three fundamental ways:

**1. Your intent is public before execution.**
Every swap, bridge, and transfer goes through a public mempool or RPC endpoint. MEV bots can see your token pair, amount, and direction before the transaction lands. On-chain observers front-run, sandwich, and extract value from your trade before it settles.

**2. Bridges are single points of failure.**
Bridging from Solana to Ethereum (or any EVM chain) means trusting a centralized relayer or a multi-sig committee with your funds mid-flight. In 2022–2023, bridge hacks accounted for over $2B in losses. "Bridgeless" is not a buzzword — it's a security requirement.

**3. Solver auctions are not blind.**
Existing intent protocols (CoW, Anoma, UniswapX) reveal the full order — wallet, amount, token pair — to all competing solvers before fill. A solver with privileged information can game the auction or front-run the winner.

**Target users:** DeFi-native Solana users who want cross-chain exposure without giving up privacy, key custody, or trade confidentiality.

---

## The Solution — Private Intent

Private Intent seals your swap intent with Fully Homomorphic Encryption (Encrypt FHE) *before* any solver ever sees it. The cross-chain order is filled via a blind solver auction where solvers bid on an encrypted hash — not the plaintext order. Execution is co-signed by Ika's MPC threshold network, so no private key ever exists on a single machine.

```
User types intent
        │
        ▼
1. Claude AI (haiku-4-5) parses natural language
   → {fromToken: SOL, toToken: PYUSD, toChain: Sepolia, amount: 0.5}
        │
        ▼
2. Encrypt FHE seals intent BEFORE routing (MEV shield)
   → ciphertext committed on Encrypt devnet
   → CrossChainOrder built with encryptedOrderData (ERC-7683-inspired)
   → solvers see only token route + encrypted hash, never amounts/addresses
        │
        ▼
3. Blind solver auction
   → 4+ competing solvers submit bids (fee%, ETA, SLA)
   → User selects best bid
   → User receives one-time Viewing Key to verify solver's proposed fill
        │
        ▼
4. Escrow lock → ResolvedOrder granted
   → On-chain escrow PDA locked on Solana devnet
   → Solver granted ResolvedOrder with temporary decrypt access
        │
        ▼
5. Ika MPC threshold co-sign (BLOCKING — no bypass)
   → Ed25519 / Secp256k1 keypair derived via DKG
   → Transaction bytes sent to Ika gRPC (requestPresign → requestSign)
   → Private key never exists on any single machine
   → Signature injected → broadcast to Solana devnet or ETH Sepolia
        │
        ▼
6. Delivery proof → escrow release
   → Solver posts proof of fill
   → Escrow released to solver
   → Intent marked SETTLED
```

---

## Why Ika and Encrypt Are Not Decorative

**Remove Ika:** `POST /api/intent/execute` returns 400 before any transaction is built. No signing path exists. The stealth address keypairs (Ed25519 for SOL, secp256k1 for ETH) cannot be generated. The native multi-chain wallet (ETH Sepolia, BTC testnet3, SOL devnet) does not exist. **The product does not function.**

**Remove Encrypt:** Swap intents are submitted to solvers in plaintext. MEV bots observe the token pair and amount from API traffic before routing completes. The blind auction is no longer blind. The MEV-resistance claim is false.

Both are essential. Neither is decorative.

---

## Features

### 1. Private Intent Engine (ERC-7683-Inspired)

The core engine implements the full CrossChainOrder lifecycle:

| Step | Endpoint | Description |
|---|---|---|
| Submit | `POST /api/intent/submit` | FHE-seal intent → build CrossChainOrder → collect solver bids |
| Status | `GET /api/intent/:id` | Live status, bids, escrow state, delivery tracking |
| Accept | `POST /api/intent/accept` | User picks solver → lock escrow → grant ResolvedOrder |
| Settle | `POST /api/intent/settle` | Solver posts proof → verify → release escrow |
| History | `GET /api/intent/history` | Privacy-preserved network activity |
| Solvers | `GET /api/intent/solvers` | All available solvers and capabilities |

**Privacy model:**
- Intent committed to Encrypt FHE devnet before any solver bid is requested
- Solvers receive only: route (tokenIn → tokenOut), fill deadline, encrypted hash
- Amounts and wallet addresses sealed in `encryptedOrderData`
- Winner gets a one-time Viewing Key to validate intent before execution
- Even the server cannot reverse the cipher without the user's viewing key

**Supported networks:**
- SOL Devnet — native SOL + PYUSD SPL token, Ika Curve25519 DKG
- ETH Sepolia — native ETH + PYUSD ERC-20, Ika Secp256k1 DKG

---

### 2. Solver Network

Four built-in solver profiles compete on every intent:

| Solver | Strategy | Focus |
|---|---|---|
| Aggressive Solver | `aggressive` | Lowest fee percentage |
| Instant Solver | `instant` | Fastest estimated delivery |
| Premium Solver | `premium` | Guaranteed SLA (slower, higher fee) |
| PYUSD Bridge Solver | `pyusd` | Specialist for PayPal USD cross-chain fills |

Plus two dynamic solvers:
- **AI Solver** — Claude-powered autonomous bidding agent that optimizes fee/speed based on current market rates
- **Live Solver** — the server's own funded keypair (SOL devnet + ETH Sepolia) that can execute real on-chain deliveries

Custom solvers can register via the registry (`services/customSolverRegistry.ts`) with their own keypairs and fee profiles.

---

### 3. Shielded Vault

A non-custodial balance layer with Ed25519 challenge-response authentication. Only the Phantom wallet owner can deposit or withdraw — every mutating operation requires a valid Ed25519 signature over a server-issued one-time nonce.

**Workflow:**
```
1. GET  /api/vault/challenge?address=<phantomPubkey>
   → {nonce, message}  (one-time, 5-minute TTL)

2. Client signs `message` with Phantom's signMessage()
   → signature (64-byte Ed25519, hex-encoded)

3. POST /api/vault/deposit   {address, amount, nonce, signature}
   or
   POST /api/vault/withdraw  {address, amount, toStealthAddress, nonce, signature}
   → Server verifies Ed25519 sig(message) against address pubkey
   → Mutation only proceeds if valid
```

Routes:

| Method | Endpoint | Auth |
|---|---|---|
| `GET` | `/api/vault/challenge` | None |
| `GET` | `/api/vault/balance` | None (read-only) |
| `POST` | `/api/vault/deposit` | Ed25519 sig required |
| `POST` | `/api/vault/withdraw` | Ed25519 sig required |
| `GET` | `/api/vault/history` | None (read-only) |

---

### 4. Private Drop (Stealth Receive)

Generate a one-time, chain-aware stealth address to receive funds privately. The address is cryptographically bound to a `monitorKey` stored server-side — only the owner can authorize a forward.

When funds are forwarded, they enter the **Dark Pool mixing layer** with a randomized 2–5 minute delay before delivery. This prevents timing analysis from linking the stealth deposit to the destination wallet.

**Two key types:**
- **SOL Devnet** → Ed25519 keypair → base58 address (Solana-native)
- **ETH Sepolia** → secp256k1 keypair → EIP-55 checksum `0x` address

**3-phase workflow:**
```
1. POST /api/stealth/receive/generate  {phantomPubkey, chain: "SOL" | "ETH"}
   → {stealthAddress, monitorKey, network, keySource}

2. Share stealthAddress with sender (copy to clipboard in UI)

3. GET  /api/stealth/receive/balance/:address
   → Auto-detects chain from address format
   → 0x prefix  → polls Sepolia RPC (eth_getBalance)
   → base58     → polls Solana devnet (getBalance)
   → {balance, chain, network, hasIncoming}

4. POST /api/stealth/receive/forward  {stealthAddress, ownerPhantomPubkey, monitorKey, amount}
   → Verifies monitorKey ownership (403 if invalid)
   → Verifies on-chain balance ≥ requested amount (422 if insufficient)
   → Places a sealed DPOrder (sell side) into the shared Dark Pool orderBook
   → Randomised 2–5 min delay before solver auction (mixing / timing privacy)
   → Returns {status: "queued_in_dark_pool", releaseAt, darkPoolOrderId}

5. GET  /api/stealth/receive/status/:address?monitorKey=<key>  (poll every ~6s)
   → monitorKey validated BEFORE entry lookup — third parties learn nothing
   → Phase 1 "queued"     → still in dark pool, returns remainingMs
   → Phase 2 "processing" → delay expired, blind solver auction in progress
   → Phase 3 "delivered"  → funds forwarded, solver settled, intentId returned
```

**UI (Private Drop tab 🫧):**
- Live 3-step progress panel (queued → processing → delivered)
- Countdown timer while in dark pool queue
- Auto-polls status every 6 seconds; clears poll on tab change / unmount

---

### 5. Dark Pool — Blind P2P Order Matching

A permissionless P2P matching engine where orders are sealed before matching. Counterparty wallet, amount, and side are never visible to the other party — only the token route (tokenIn → tokenOut) is revealed for matching purposes.

**Matching rule:** opposite side + mirrored route + compatible price limits

The Dark Pool also serves as the **mixing layer for Private Drop** — every stealth forward places a real sealed `DPOrder` (sell side) into the shared order book before the solver auction runs. The order is marked `matched` upon delivery, keeping the book consistent.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/darkpool/order` | Place a sealed buy/sell order |
| `GET` | `/api/darkpool/book` | Anonymized open order book (no wallet/amount/side) |
| `GET` | `/api/darkpool/myorders` | Caller's own orders with full detail |
| `DELETE` | `/api/darkpool/order/:id` | Cancel an open order |

---

### 6. Native Multi-Chain Wallet (Ika DKG)

Create a multi-chain wallet via Ika Distributed Key Generation. One DKG session derives addresses for all four supported curves simultaneously — no seed phrase, no single point of key custody.

| Chain | Curve | Network |
|---|---|---|
| Ethereum | secp256k1 | Sepolia testnet |
| Bitcoin | secp256k1 | Testnet3 |
| Solana | Ed25519 | Devnet |
| Polkadot | sr25519 | Westend testnet |

Routes:

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/native/wallet/create` | DKG via Ika → derive addresses for all chains |
| `POST` | `/native/sign/eth` | Sign + broadcast Ethereum tx on Sepolia |
| `POST` | `/native/sign/btc` | Sign + broadcast Bitcoin tx on Testnet3 |
| `POST` | `/native/sign/sol` | Sign + broadcast Solana tx on Devnet |
| `GET` | `/native/wallet/:id` | Get wallet + all derived addresses |

---

### 7. AI-Powered Features

All AI features use Claude (haiku-4-5) via the Anthropic integration:

- **Natural language intent parsing** — type "swap 0.5 SOL to PYUSD on Sepolia" and Claude extracts structured intent fields
- **AI Solver Agent** — autonomous solver that bids using current live rates, optimizing for fee or speed based on market conditions
- **Dispute Resolution** — Claude acts as neutral judge for contested fills; reviews intent hash, solver proof, and on-chain evidence
- **Route Optimization** — AI recommends optimal solver strategy based on amount, urgency, and current fees

Routes:

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/intent/parse` | NL → structured intent |
| `POST` | `/api/ai/solve` | AI solver bid for given intent |
| `POST` | `/api/ai/dispute` | AI dispute judge |

---

### 8. Live Rates

Real-time spot prices from CoinGecko with 60-second cache.

```bash
GET /api/rates
→ {
    prices: { SOL: 93.42, ETH: 2332.44, PYUSD: 1.00 },
    rates: { SOL_ETH: 0.04005, ETH_SOL: 24.97, ... },
    source: "coingecko",
    cacheTtlSeconds: 60
  }
```

---

### 9. Integration Health Check

Live status of all external network connections:

```bash
GET /api/healthz/integrations
```

Returns status for: Ika gRPC (latency probe), Encrypt gRPC, Anthropic Claude, Solana devnet, and Bitcoin testnet3.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Web Dashboard (React 19 + Vite 7)               port 8081  │
│  artifacts/prism-dwallet-web/                               │
│  ├─ Connect Phantom → parse NL intent                       │
│  ├─ Blind solver auction UI (fee%, ETA, SLA comparison)     │
│  ├─ Private Drop 🫧 (stealth addr gen + dark pool mixing)   │
│  ├─ Shielded Vault (deposit/withdraw with sig auth)         │
│  ├─ Dark Pool order book                                    │
│  └─ History, dispute, privacy proof viewer                  │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP (REST)
┌──────────────────────▼──────────────────────────────────────┐
│  API Server (Express 5 + TypeScript + Node 24)   port 8080  │
│  artifacts/api-server/                                       │
│  routes/                                                     │
│  ├─ privateIntent.ts   ERC-7683 CrossChainOrder lifecycle   │
│  ├─ stealthReceive.ts  Chain-aware stealth keypair gen      │
│  ├─ vault.ts           Ed25519-authed shielded vault        │
│  ├─ darkpool.ts        Blind P2P matching engine            │
│  ├─ native.ts          Multi-chain wallet + broadcast       │
│  ├─ dwallet.ts         Ika DKG create/get                   │
│  ├─ aiRoutes.ts        Claude AI parse/solve/dispute        │
│  ├─ rates.ts           CoinGecko live rates (60s cache)     │
│  └─ health.ts          Integration status probe             │
│  services/                                                   │
│  ├─ ika.ts             gRPC: DKG → Presign → Co-sign        │
│  ├─ ikaMultichain.ts   Multi-curve DKG (Ed25519/secp256k1)  │
│  ├─ encrypt.ts         gRPC: FHE seal + AES-256-GCM hybrid  │
│  ├─ liveRates.ts       CoinGecko prices + cross-rates       │
│  ├─ solverEngine.ts    Solver profiles + bid generation     │
│  ├─ liveSolverService  Live on-chain delivery (SOL + ETH)   │
│  ├─ aiSolverAgent.ts   Claude-powered autonomous solver     │
│  ├─ nativeSigner.ts    ETH/BTC/SOL sign + broadcast         │
│  └─ solanaBroadcast.ts Sentinel keypair + memo tx           │
└──────────────────────┬──────────────────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
   Ika devnet    Encrypt devnet   Solana devnet
   gRPC MPC      gRPC FHE        api.devnet.solana.com
   DKG + sign    intent seal     escrow PDA + broadcast
```

### Monorepo Structure

```
artifacts/
  api-server/              Express 5 backend (port 8080)
  prism-dwallet-web/       React 19 + Vite 7 web dashboard (port 8081)
  pitch-deck/              Hackathon pitch deck
lib/
  db/                      Drizzle ORM schema + PostgreSQL migrations
  api-zod/                 Shared Zod validation schemas
  api-spec/                OpenAPI spec
  integrations-anthropic-ai/  Anthropic Claude integration wrapper
scripts/                   Migration helpers
```

### Database Tables

| Table | Purpose |
|---|---|
| `intents` | CrossChainOrder lifecycle — status, bids, escrow, proof |
| `dwallet_profiles` | Ika DKG outputs — dwalletId, pubkey, viewingKeyHash |
| `native_wallets` | Multi-chain wallets — pubkeyHex, eth/btc/sol addresses |
| `vault_balances` | Shielded vault — address → shielded balance |
| `vault_history` | Vault operation log — deposits, withdrawals |

---

## External Networks

| Network | Endpoint | Used For |
|---|---|---|
| **Ika devnet** | `pre-alpha-dev-1.ika.ika-network.net:443` | MPC DKG + co-sign |
| **Encrypt devnet** | `pre-alpha-dev-1.encrypt.ika-network.net:443` | FHE intent seal |
| **Solana devnet** | `https://api.devnet.solana.com` | Escrow PDA, memo tx, SOL balance |
| **ETH Sepolia** | `https://ethereum-sepolia-rpc.publicnode.com` | ETH balance + broadcast |
| **CoinGecko** | `https://api.coingecko.com` | Live SOL/ETH/PYUSD prices |

> **Why all testnet/devnet?** Ika and Encrypt are pre-alpha (devnet only). Keeping every leg on pre-production networks means Ika = real MPC custody, Encrypt = real FHE seal, escrow = real on-chain PDAs. When Ika/Encrypt launch mainnet, one config change makes this day-one mainnet.

---

## Deployed Program IDs (Solana Devnet)

| Protocol | Program ID |
|---|---|
| Ika dWallet | `87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY` |
| Encrypt FHE | `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8` |

---

## Build & Run Locally (Windows)

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 24+ | `node --version` |
| pnpm | 9+ | `npm i -g pnpm` |
| PostgreSQL | 14+ | Local install. Service must be running. |

> **⚠️ Windows Note:** This project was originally built for Linux/Replit. The following instructions include fixes for running on Windows.

---

### Step 1 — Clone & Install

```bash
git clone <repo-url>
cd private-intent

# Install dependencies
pnpm install
```

> **Windows fix:** The `preinstall` script has been rewritten from `sh -c` to `node -e` for Windows compatibility.
> **Windows fix:** Platform-specific overrides in `pnpm-workspace.yaml` for `@esbuild/win32-x64`, `@rollup/rollup-win32-x64-msvc`, `lightningcss-win32-x64-msvc`, and `@tailwindcss/oxide-win32-x64-msvc` have been removed to allow native Windows binaries.

---

### Step 2 — Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
# edit .env with your values
```

Required variables:

```bash
# Required
DATABASE_URL=postgresql://postgres:password@localhost:5432/private_intent

# Required for AI features (leave empty to skip AI)
AI_INTEGRATIONS_ANTHROPIC_BASE_URL=https://api.anthropic.com
AI_INTEGRATIONS_ANTHROPIC_API_KEY=sk-ant-...

# Port for API server
PORT=8080
```

Optional variables (see `.env.example` for details):
- `SOLANA_SECRET_KEY_ARRAY` — persist sentinel keypair across restarts
- `SOLANA_DEVNET_PUBKEY` — sentinel public key (base58)
- `ETH_SOLVER_PRIVATE_KEY` — Live Solver ETH wallet (for real testnet delivery)
- `MASTER_ENCRYPT_KEY` — FHE master key (64 hex chars)

**What needs no keys at all:**
- Ika devnet — public gRPC endpoint, no registration
- Encrypt devnet — public gRPC endpoint, no registration
- Solana devnet — public RPC, no registration (`https://api.devnet.solana.com`)
- ETH Sepolia — public RPC, no registration

---

### Step 3 — Database Setup

Make sure PostgreSQL is running:

```bash
# Windows: check if service is running
Get-Service -Name postgresql* | Format-Table Status, Name

# Start PostgreSQL if stopped (may need admin rights)
& "C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe" start -D "C:\Program Files\PostgreSQL\17\data"
```

Create the database and run migrations:

```bash
# Create the database
createdb -U postgres private_intent

# Or restore from backup if available:
psql -U postgres -d private_intent -f /path/to/backup.sql

# Run Drizzle migrations
pnpm --filter @workspace/db run generate
pnpm --filter @workspace/db run migrate
```

---

### Step 4 — Build & Start the API Server

```powershell
# Set environment variables and run
$env:DATABASE_URL="postgresql://postgres@localhost:5432/private_intent"
$env:PORT="8080"
$env:AI_INTEGRATIONS_ANTHROPIC_BASE_URL="https://api.anthropic.com"
$env:AI_INTEGRATIONS_ANTHROPIC_API_KEY="sk-placeholder"  # replace with real key

# Build (esbuild)
pnpm --filter @workspace/api-server run build

# Start server
pnpm --filter @workspace/api-server run start
```

Expected output:
```
[Solana] Sentinel keypair loaded from env — pubkey=99pdEHxysxtd6KhFQ6im6NRAX5hHUm3rpMNJSCjUjfBQ
[LiveSolver] ETH wallet generated: 0x...
[LiveSolver] Auto-registered.
[LiveRates] CoinGecko SOL=$96.xx ETH=$229x.xx PYUSD=$1.00
[Ika] gRPC connectivity OK — pre-alpha-dev-1.ika.ika-network.net:443 (3051ms)
[INFO] Server listening port=8080
```

---

### Step 5 — Start the Web Dashboard (New Terminal)

Open a **new PowerShell terminal**:

```powershell
$env:Path = "C:\Program Files\nodejs;$env:APPDATA\npm;$env:Path"
cd C:\Users\...\PrivateIntent
$env:PORT="8081"
pnpm --filter @workspace/prism-dwallet-web run dev
```

Expected output:
```
VITE v7.3.2 ready in 1952ms
Local: http://localhost:8081/
```

Open http://localhost:8081 in your browser.

---

### Step 6 — Run All Services Together

| Terminal | Command | Port |
|---|---|---|
| **Terminal 1** — API server | See Step 4 | `8080` |
| **Terminal 2** — Web dashboard | `$env:PORT="8081"; pnpm --filter @workspace/prism-dwallet-web run dev` | `8081` |
| **Background** — PostgreSQL | Must be running | `5432` |

---

### Step 7 — Verify Everything Works

**Check API health:**
```bash
curl http://localhost:8080/api/healthz
# → {"status":"ok"}
```

**Check integration health:**
```bash
curl http://localhost:8080/api/healthz/integrations
# → includes ika, encrypt, solana, ethereum, coingecko statuses
```

**Get live rates:**
```bash
curl http://localhost:8080/api/rates
# → {"prices":{"SOL":96.16,"ETH":2299.29,"PYUSD":1.00}, ...}
```

**List all solvers:**
```bash
curl http://localhost:8080/api/intent/solvers | jq '.solvers[].name'
```

**Get intent history (from database):**
```bash
curl http://localhost:8080/api/intent/history
```

**Submit a private intent:**
```bash
curl -X POST http://localhost:8080/api/intent/submit \
  -H "Content-Type: application/json" \
  -d '{
    "phantomPubkey": "<your-solana-pubkey>",
    "fromToken": "SOL",
    "toToken": "PYUSD",
    "fromChain": "SOL",
    "toChain": "ETH",
    "amount": "0.5"
  }'
```

---

## Complete API Reference

### Intent Engine

| Method | Endpoint | Body / Query | Description |
|---|---|---|---|
| `POST` | `/api/intent/submit` | `{phantomPubkey, fromToken, toToken, fromChain, toChain, amount}` | FHE-seal → CrossChainOrder → solver bids |
| `GET` | `/api/intent/:id` | — | Live intent status + bids + delivery |
| `POST` | `/api/intent/accept` | `{intentId, solverId, phantomPubkey}` | Lock escrow, grant ResolvedOrder |
| `POST` | `/api/intent/settle` | `{intentId, solverId, proofHash, deliveryTx}` | Verify proof → release escrow |
| `GET` | `/api/intent/history` | — | Privacy-preserved network activity |
| `GET` | `/api/intent/solvers` | — | All available solvers |
| `POST` | `/api/intent/parse` | `{text}` | Claude NL → structured intent |

### Private Drop (Stealth Receive)

> **Auth note:** `/status` validates `monitorKey` before checking entry existence — third parties probing a stealth address always receive `403` and cannot enumerate queue state.

| Method | Endpoint | Body / Params | Description |
|---|---|---|---|
| `POST` | `/api/stealth/receive/generate` | `{phantomPubkey, chain}` | Generate chain-aware stealth address |
| `GET` | `/api/stealth/receive/balance/:address` | `:address` | Poll balance (chain auto-detected) |
| `POST` | `/api/stealth/receive/forward` | `{stealthAddress, ownerPhantomPubkey, monitorKey, amount}` | Queue into dark pool with 2–5 min mixing delay |
| `GET` | `/api/stealth/receive/status/:address` | `?monitorKey=` | Poll delivery phase: queued → processing → delivered |

### Shielded Vault

| Method | Endpoint | Body / Query | Description |
|---|---|---|---|
| `GET` | `/api/vault/challenge` | `?address=` | Issue one-time nonce to sign |
| `GET` | `/api/vault/balance` | `?address=` | Shielded balance |
| `POST` | `/api/vault/deposit` | `{address, amount, nonce, signature}` | Shield assets (Ed25519 auth) |
| `POST` | `/api/vault/withdraw` | `{address, amount, toStealthAddress, nonce, signature}` | Unshield to stealth address (Ed25519 auth) |
| `GET` | `/api/vault/history` | `?address=` | Recent vault operations |

### Dark Pool

| Method | Endpoint | Body / Params | Description |
|---|---|---|---|
| `POST` | `/api/darkpool/order` | `{phantomPubkey, side, tokenIn, tokenOut, amount, priceLimit?}` | Place sealed order |
| `GET` | `/api/darkpool/book` | — | Anonymized open book |
| `GET` | `/api/darkpool/myorders` | `?phantomPubkey=` | Caller's own orders |
| `DELETE` | `/api/darkpool/order/:id` | — | Cancel order |

### Native Multi-Chain Wallet

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `POST` | `/native/wallet/create` | `{chain: "ethereum"\|"bitcoin"\|"solana"\|"polkadot"}` | Ika DKG → multi-chain addresses |
| `GET` | `/native/wallet/:id` | — | Get wallet + all addresses |
| `POST` | `/native/sign/eth` | `{walletId, to, value, data?}` | Sign + broadcast ETH tx (Sepolia) |
| `POST` | `/native/sign/btc` | `{walletId, to, satoshis}` | Sign + broadcast BTC tx (Testnet3) |
| `POST` | `/native/sign/sol` | `{walletId, to, lamports}` | Sign + broadcast SOL tx (Devnet) |

### AI & Rates

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/rates` | Live SOL/ETH/PYUSD prices (CoinGecko, 60s cache) |
| `POST` | `/api/ai/solve` | AI solver bid for given intent |
| `POST` | `/api/ai/dispute` | Claude judges a contested fill |

### System

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/healthz` | Simple liveness check |
| `GET` | `/api/healthz/integrations` | Live status of all external networks |

---

## Verifying On-Chain (for Judges)

| Claim | How to verify |
|---|---|
| **Ika MPC DKG is real** | `POST /native/wallet/create` → inspect `mode: "devnet"` + `attestationHex` in response. The public key was generated by Ika's threshold network, never by a single server. |
| **Encrypt FHE seal is real** | `POST /api/intent/submit` → `crossChainOrder.encryptedOrderData` is an on-chain ciphertext commitment to Encrypt devnet, created before any solver bid |
| **Blind auction is blind** | `GET /api/intent/solvers` shows bid structure — `inputAmount` field reads `"SEALED (Encrypt FHE — MEV shield)"` |
| **Ed25519 auth on vault** | `POST /api/vault/deposit` with a forged or mismatched signature → HTTP 403 |
| **Chain-aware stealth keys** | `chain: "ETH"` → returns `0x...` EIP-55 address (secp256k1). `chain: "SOL"` → returns base58 Ed25519 address |
| **Private Drop dark pool mixing** | `POST /api/stealth/receive/forward` → response contains `darkPoolOrderId`. `GET /api/darkpool/book` → that order ID appears as an open sell entry. After delivery, `GET /api/darkpool/myorders?phantomPubkey=...` → order status shows `matched` |
| **Status auth prevents enumeration** | `GET /api/stealth/receive/status/<any-address>` (no monitorKey) → `403`. Third parties cannot learn whether an address has an active dark pool entry |
| **Ika gRPC liveness** | `GET /api/healthz/integrations` → `ika.grpcReachable: true`, `ika.grpcLatencyMs: <4000` |

---

## Live Endpoints

| Resource | URL |
|---|---|
| API | `https://sentinel-riharahap252.replit.app` |
| Web dashboard | `https://sentinel-riharahap252.replit.app/` |
| Pitch deck | `https://sentinel-riharahap252.replit.app/pitch-deck/` |
| Integration health | `https://sentinel-riharahap252.replit.app/api/healthz/integrations` |
| Live rates | `https://sentinel-riharahap252.replit.app/api/rates` |

---

## Track

**Hybrid Solutions — Ika + Encrypt** (both technologies, both essential)

Private Intent directly implements two use cases from the hackathon scope:

- *"Create a fast bridgeless trading experience for native assets directly on Solana"* — Ika dWallet as the custody and signing layer; no bridge required because both chains use Ika-cosigned execution
- *"Build fully confidential DeFi applications for private trading at scale"* — Encrypt FHE seals swap intents before any solver or router ever sees the plaintext; solver auction is blind by construction

---

*Built for the Colosseum Frontier Hackathon 2026 — Ika + Encrypt track.*
