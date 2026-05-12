/**
 * Shielded Vault API — DB-backed balance tracking with Ed25519 authz
 *
 * Auth flow for mutating ops (deposit/withdraw):
 *   1. Client: GET /api/vault/challenge?address=<phantomPubkey>
 *      → Server returns {nonce, message} (one-time, 5-min TTL)
 *   2. Client: signs `message` with Phantom wallet (Ed25519 / signMessage)
 *   3. Client: POST /api/vault/deposit|withdraw with {address, ..., nonce, signature}
 *      → Server verifies Ed25519 sig(message) against address pubkey before mutating
 *
 * Routes:
 *   GET  /api/vault/challenge  — issue one-time nonce + message to sign
 *   GET  /api/vault/balance    — shielded balance for address (read-only)
 *   POST /api/vault/deposit    — shield assets (requires valid signature)
 *   POST /api/vault/withdraw   — unshield → real stealth keypair → Dark Pool queue (requires sig)
 *   GET  /api/vault/history    — recent vault operations (read-only)
 */

import { Router } from "express";
import { randomBytes } from "crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { db } from "@workspace/db";
import { vaultBalancesTable, vaultHistoryTable, type VaultHistoryEntry } from "@workspace/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { generateStealthKeypair } from "../services/stealthKeypair.js";
import { stealthStore, type StealthEntry } from "./stealthReceive.js";
import { orderBook, sealedId, type DPOrder } from "./darkpool.js";

const router = Router();

// ── Challenge store: address → {nonce, message, expires} ─────────────────────
const vaultChallenges = new Map<string, { nonce: string; message: string; expires: number }>();

function issueChallenge(address: string): { nonce: string; message: string } {
  const nonce = randomBytes(16).toString("hex");
  const message = `Authorize Private Intent vault operation\nAddress: ${address}\nNonce: ${nonce}`;
  vaultChallenges.set(address, { nonce, message, expires: Date.now() + 5 * 60 * 1000 });
  return { nonce, message };
}

// ── Ed25519 signature verification ────────────────────────────────────────────
function verifyAndConsume(address: string, nonce: string, signatureHex: string): boolean {
  const stored = vaultChallenges.get(address);
  if (!stored) return false;
  if (Date.now() > stored.expires) { vaultChallenges.delete(address); return false; }
  if (stored.nonce !== nonce) return false;
  try {
    const pubkeyBytes = bs58.decode(address);
    const msgBytes = Buffer.from(stored.message, "utf8");
    const sigBytes = Buffer.from(signatureHex, "hex");
    const valid = ed25519.verify(sigBytes, msgBytes, pubkeyBytes);
    if (valid) vaultChallenges.delete(address);
    return valid;
  } catch {
    return false;
  }
}

// ── Address validation ────────────────────────────────────────────────────────
function isValidAddress(addr: string): boolean {
  if (!addr || typeof addr !== "string") return false;
  if (addr.length < 10 || addr.length > 64) return false;
  return /^[1-9A-HJ-NP-Za-km-z0-9x]{10,64}$/.test(addr);
}

// ── DB helpers ────────────────────────────────────────────────────────────────
async function getBalance(address: string): Promise<{ SOL: number; ETH: number }> {
  const [row] = await db.select().from(vaultBalancesTable)
    .where(eq(vaultBalancesTable.address, address)).limit(1);
  if (!row) return { SOL: 0, ETH: 0 };
  return { SOL: parseFloat(row.sol), ETH: parseFloat(row.eth) };
}

async function upsertBalance(address: string, sol: number, eth: number): Promise<void> {
  await db.insert(vaultBalancesTable)
    .values({ address, sol: sol.toFixed(9), eth: eth.toFixed(9) })
    .onConflictDoUpdate({
      target: vaultBalancesTable.address,
      set: { sol: sql`EXCLUDED.sol`, eth: sql`EXCLUDED.eth`, updatedAt: new Date() },
    });
}

// ── GET /api/vault/challenge?address=... ─────────────────────────────────────
router.get("/vault/challenge", async (req, res): Promise<void> => {
  const address = String(req.query.address ?? "").trim();
  if (!isValidAddress(address)) { res.status(400).json({ error: "Invalid address format" }); return; }
  const { nonce, message } = issueChallenge(address);
  res.json({
    nonce,
    message,
    address,
    expiresIn: 300,
    instructions: "Sign `message` with Phantom wallet (window.solana.signMessage). Include {nonce, signature} in mutating requests.",
  });
});

// ── GET /api/vault/balance?address=... ────────────────────────────────────────
router.get("/vault/balance", async (req, res): Promise<void> => {
  const address = String(req.query.address ?? "").trim();
  if (!isValidAddress(address)) { res.status(400).json({ error: "Invalid address format" }); return; }
  const balance = await getBalance(address);
  res.json({ address, balance, shielded: true });
});

// ── POST /api/vault/deposit ───────────────────────────────────────────────────
router.post("/vault/deposit", async (req, res): Promise<void> => {
  const { address, token, amount, nonce, signature } = req.body as {
    address: string; token: string; amount: string; nonce: string; signature: string;
  };
  if (!isValidAddress(address)) { res.status(400).json({ error: "Invalid address format" }); return; }
  if (!nonce || !signature) {
    res.status(401).json({ error: "nonce and signature required. Call GET /api/vault/challenge first." }); return;
  }
  if (!verifyAndConsume(address, nonce, signature)) {
    res.status(401).json({ error: "Invalid or expired signature. Challenge must be re-issued." }); return;
  }
  if (!token || !amount) { res.status(400).json({ error: "token and amount required" }); return; }
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) { res.status(400).json({ error: "Invalid amount" }); return; }
  const t = token.toUpperCase() as "SOL" | "ETH";
  if (!["SOL", "ETH"].includes(t)) { res.status(400).json({ error: "token must be SOL or ETH" }); return; }

  const current = await getBalance(address);
  const newBal = { ...current };
  newBal[t] = (current[t] ?? 0) + amt;
  await upsertBalance(address, newBal.SOL, newBal.ETH);

  await db.insert(vaultHistoryTable).values({
    address, type: "deposit", token: t, amount: amt.toFixed(9),
  });

  res.json({
    success: true,
    balance: newBal,
    note: "Assets shielded — balance obfuscated on-chain explorer",
  });
});

// ── POST /api/vault/withdraw ──────────────────────────────────────────────────
// Unshields assets to a REAL one-time stealth keypair (Ed25519 for SOL, secp256k1 for ETH).
// Stealth address is immediately registered and queued into the shared Dark Pool (2–5 min delay).
// Returns monitorKey — poll /api/stealth/receive/status/:stealthAddress?monitorKey=... to track.
router.post("/vault/withdraw", async (req, res): Promise<void> => {
  const { address, token, amount, nonce, signature, chain: chainOverride } = req.body as {
    address: string; token: string; amount: string; nonce: string; signature: string;
    chain?: "SOL" | "ETH";
  };
  if (!isValidAddress(address)) { res.status(400).json({ error: "Invalid address format" }); return; }
  if (!nonce || !signature) {
    res.status(401).json({ error: "nonce and signature required. Call GET /api/vault/challenge first." }); return;
  }
  if (!verifyAndConsume(address, nonce, signature)) {
    res.status(401).json({ error: "Invalid or expired signature. Challenge must be re-issued." }); return;
  }
  if (!token || !amount) { res.status(400).json({ error: "token and amount required" }); return; }
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) { res.status(400).json({ error: "Invalid amount" }); return; }
  const t = token.toUpperCase() as "SOL" | "ETH";
  if (!["SOL", "ETH"].includes(t)) { res.status(400).json({ error: "token must be SOL or ETH" }); return; }
  // chain must match token to prevent semantic mismatches between vault balance and stealth keypair type.
  // Optional chain override is validated but must equal the token type — different assets are not interchangeable.
  if (chainOverride && chainOverride !== t) {
    res.status(400).json({ error: `chain must match token: token=${t} but chain=${chainOverride}. Omit chain to use the token's native chain.` }); return;
  }
  const resolvedChain: "SOL" | "ETH" = t;

  const current = await getBalance(address);
  if ((current[t] ?? 0) < amt) {
    res.status(400).json({ error: `Insufficient shielded ${t} balance` }); return;
  }
  const newBal = { ...current };
  newBal[t] -= amt;
  await upsertBalance(address, newBal.SOL, newBal.ETH);

  // ── Generate REAL one-time stealth keypair (Ed25519 / secp256k1) ─────────
  const { stealthAddress, secretKeyHex, chain, network, keySource } = generateStealthKeypair(resolvedChain);
  const monitorKey = randomBytes(32).toString("hex");

  // ── Queue into shared Dark Pool orderBook (2–5 min randomized delay) ─────
  const delayMs   = (Math.random() * 3 + 2) * 60 * 1000;
  const releaseAt = Date.now() + delayMs;

  const dpOrderId = randomBytes(16).toString("hex");
  const dpEncHash = sealedId(`vault:${address}:${dpOrderId}:${Date.now()}`);
  const dpOrder: DPOrder = {
    id:            dpOrderId,
    phantomPubkey: address,
    side:          "sell",
    tokenIn:       t,
    tokenOut:      t,
    amount:        amt,
    status:        "open",
    encHash:       dpEncHash,
    ts:            Date.now(),
  };
  orderBook.set(dpOrderId, dpOrder);

  // ── Register in stealthStore so /api/stealth/receive/status can track it ─
  const entry: StealthEntry = {
    secretKeyHex,
    monitorKey,
    ownerPhantomPubkey: address,
    chain,
    createdAt:         Date.now(),
    used:              false,
    darkPoolStatus:    "queued",
    darkPoolReleaseAt: releaseAt,
    darkPoolAmount:    amt,
    darkPoolOrderId:   dpOrderId,
  };
  stealthStore.set(stealthAddress, entry);

  console.log(`[vault/withdraw] stealth=${stealthAddress} chain=${chain} amt=${amt} dp=${dpOrderId} releaseIn=${Math.round(delayMs / 1000)}s`);

  await db.insert(vaultHistoryTable).values({
    address, type: "withdraw", token: t, amount: amt.toFixed(9), stealthAddress,
  });

  const releaseAtIso  = new Date(releaseAt).toISOString();
  const remainingMs   = Math.round(delayMs);
  const remainingMin  = parseFloat((delayMs / 60000).toFixed(1));
  res.json({
    success:          true,
    stealthAddress,
    monitorKey,
    chain,
    network,
    keySource,
    darkPoolOrderId:  dpOrderId,
    releaseAt:        releaseAtIso,
    remainingMs,
    remainingMin,
    balance:          newBal,
    darkPool: {
      orderId:        dpOrderId,
      status:         "queued",
      releaseAt:      releaseAtIso,
      remainingMs,
      remainingMin,
      pollUrl:        `/api/stealth/receive/status/${stealthAddress}?monitorKey=${monitorKey}`,
      privacyHops:    ["vault_unshield", "stealth_address", "dark_pool_mixing", "solver_pool", "main_wallet"],
    },
    note: "Withdrawn to one-time stealth address — queued in Dark Pool for privacy mixing (4-hop privacy chain)",
  });
});

// ── GET /api/vault/history?address=... ───────────────────────────────────────
router.get("/vault/history", async (req, res): Promise<void> => {
  const address = String(req.query.address ?? "").trim();
  if (!isValidAddress(address)) { res.status(400).json({ error: "Invalid address format" }); return; }

  const rows = await db.select().from(vaultHistoryTable)
    .where(eq(vaultHistoryTable.address, address))
    .orderBy(desc(vaultHistoryTable.ts))
    .limit(30);

  const history = rows.map((r: VaultHistoryEntry) => ({
    type: r.type,
    token: r.token,
    amount: parseFloat(r.amount),
    stealthAddress: r.stealthAddress ?? undefined,
    ts: r.ts.toISOString(),
  }));

  res.json({ history });
});

export default router;
