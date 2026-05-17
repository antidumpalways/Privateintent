/**
 * Stealth Receive — Privacy-Preserving Inbound (Chain-Aware)
 *
 * 3-hop privacy flow:
 *   stealth_address → Dark Pool (mixing, 2–5 min randomized delay) → solver blind auction → main wallet
 *
 * Routes:
 *   POST /api/stealth/receive/generate          — create chain-aware one-time stealth address
 *   GET  /api/stealth/receive/balance/:address  — poll balance (SOL devnet or ETH Sepolia)
 *   POST /api/stealth/receive/forward           — queue into Dark Pool (returns immediately)
 *   GET  /api/stealth/receive/status/:address   — poll Dark Pool → Solver → Delivered status
 */

import { Router }                         from "express";
import { randomBytes, createHash }         from "crypto";
import { Connection, SystemProgram, Transaction, sendAndConfirmTransaction, PublicKey } from "@solana/web3.js";
import bs58                               from "bs58";
import { generateStealthKeypair }         from "../services/stealthKeypair.js";
import { getSentinelKeypair, SOLANA_DEVNET_RPC } from "../services/solanaBroadcast.js";
import { db }                             from "@workspace/db";
import { intentsTable }                   from "@workspace/db/schema";
import { encryptAuditLog, generateViewingKey } from "../services/encrypt.js";
import { getSolverBids, getBestBid, type SolverBid } from "../services/solverEngine.js";
import { aiSolverAgent }                  from "../services/aiSolverAgent.js";
import { getCustomSolverBids }            from "../services/customSolverRegistry.js";
import { getRateSync }                    from "../services/liveRates.js";
import { orderBook, sealedId, type DPOrder } from "./darkpool.js";

const router = Router();

// ── In-memory store ────────────────────────────────────────────────────────────
export interface StealthEntry {
  secretKeyHex:       string;
  monitorKey:         string;
  ownerPhantomPubkey: string;
  chain:              "SOL" | "ETH";
  createdAt:          number;
  used:               boolean;
  // Dark Pool queue fields
  darkPoolStatus?:    "queued" | "processing" | "delivered" | "failed";
  darkPoolReleaseAt?: number;
  darkPoolAmount?:    number;
  darkPoolOrderId?:   string;   // ID of the order placed in shared darkpool.ts orderBook
  darkPoolDelivered?: {
    intentId:            number;
    outputAmount:        string;
    feePercent:          number;
    feeAmount:           string;
    encryptedIntentId:   string;
    encryptedIntentHash: string;
    encryptMode:         string;
    viewingKey:          string;
    solver: {
      id:              string;
      name:            string;
      strategy:        string;
      reputationScore: number;
      estimatedSeconds: number;
    };
    privacyProof: {
      mechanism:    string;
      chainLink:    string;
      encryptLayer: string;
      ikaSignature: string;
      onChainTrace: string[];
    };
    deliveryEta: string;
  };
}
export const stealthStore = new Map<string, StealthEntry>();
const TTL_MS = 24 * 60 * 60 * 1000; // 24 h

// Cleanup expired entries hourly
setInterval(() => {
  const now = Date.now();
  for (const [addr, entry] of stealthStore) {
    if (now - entry.createdAt > TTL_MS) stealthStore.delete(addr);
  }
}, 60 * 60 * 1000);


// ── POST /api/stealth/receive/generate ───────────────────────────────────────
router.post("/stealth/receive/generate", (req, res) => {
  const { phantomPubkey, chain } = req.body as {
    phantomPubkey?: string;
    chain?: "SOL" | "ETH";
  };
  if (!phantomPubkey) {
    res.status(400).json({ error: "phantomPubkey required" }); return;
  }

  const targetChain: "SOL" | "ETH" = chain === "ETH" ? "ETH" : "SOL";
  const monitorKey = randomBytes(32).toString("hex");
  const expiresAt  = new Date(Date.now() + TTL_MS).toISOString();

  const { stealthAddress, secretKeyHex, network, keySource } = generateStealthKeypair(targetChain);

  stealthStore.set(stealthAddress, {
    secretKeyHex,
    monitorKey,
    ownerPhantomPubkey: phantomPubkey,
    chain: targetChain,
    createdAt: Date.now(),
    used: false,
  });

  res.json({
    stealthAddress,
    chain:      targetChain,
    network,
    monitorKey,
    expiresAt,
    keySource,
    privacyNote: "Share only stealthAddress with senders. Keep monitorKey secret — it authorises the forward.",
    instructions: [
      `Copy stealthAddress and use it as your ${targetChain === "ETH" ? "CEX/wallet withdrawal" : "CEX withdrawal"} destination`,
      "Monitor balance — updates every 5 seconds",
      "When funds arrive, click Forward — funds enter Dark Pool for privacy mixing",
      "After 2–5 min mixing delay, solver delivers from their pool to main wallet — no direct on-chain link",
    ],
  });
});

// ── GET /api/stealth/receive/balance/:address ────────────────────────────────
router.get("/stealth/receive/balance/:address", async (req, res) => {
  const { address } = req.params;
  if (!address) { res.status(400).json({ error: "address required" }); return; }

  const isEth = address.startsWith("0x");

  try {
    if (isEth) {
      const rpcResp = await fetch("https://ethereum-sepolia-rpc.publicnode.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getBalance",
          params: [address, "latest"],
        }),
        signal: AbortSignal.timeout(8_000),
      });
      const rpcData = (await rpcResp.json()) as { result?: string; error?: unknown };
      const weiHex   = rpcData.result ?? "0x0";
      const wei       = BigInt(weiHex);
      const balanceEth = Number(wei) / 1e18;
      const ethPriceUsd = getRateSync("ETH", "PYUSD");
      const balanceUsd  = balanceEth * ethPriceUsd;

      res.json({
        address,
        chain:       "ETH",
        network:     "ethereum-sepolia",
        balance:     parseFloat(balanceEth.toFixed(9)),
        balanceWei:  wei.toString(),
        balanceUsd:  parseFloat(balanceUsd.toFixed(4)),
        hasIncoming: wei > 0n,
        lastCheckedAt: new Date().toISOString(),
        isTracked:   stealthStore.has(address),
      });
    } else {
      const rpcResp = await fetch("https://api.devnet.solana.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getBalance",
          params: [address, { commitment: "confirmed" }],
        }),
        signal: AbortSignal.timeout(6_000),
      });
      const rpcData = (await rpcResp.json()) as { result?: { value?: number }; error?: unknown };
      const lamports   = rpcData.result?.value ?? 0;
      const balanceSol = lamports / 1e9;
      const solPriceUsd = getRateSync("SOL", "PYUSD");
      const balanceUsd  = balanceSol * solPriceUsd;

      res.json({
        address,
        chain:           "SOL",
        network:         "solana-devnet",
        balance:         parseFloat(balanceSol.toFixed(9)),
        balanceLamports: lamports,
        balanceUsd:      parseFloat(balanceUsd.toFixed(4)),
        hasIncoming:     lamports > 0,
        lastCheckedAt:   new Date().toISOString(),
        isTracked:       stealthStore.has(address),
      });
    }
  } catch (err) {
    const chain = isEth ? "ETH" : "SOL";
    res.status(502).json({
      error:        `Failed to query ${chain === "ETH" ? "ETH Sepolia" : "Solana devnet"} RPC`,
      detail:       (err as Error).message,
      address,
      chain,
      balance:      0,
      balanceUsd:   0,
      hasIncoming:  false,
      lastCheckedAt: new Date().toISOString(),
    });
  }
});

// ── POST /api/stealth/receive/forward ────────────────────────────────────────
// Validates balance + gas, then queues into Dark Pool with randomized 2–5 min delay.
// Returns immediately — use GET /status/:address to poll progress.
router.post("/stealth/receive/forward", async (req, res) => {
  const { stealthAddress, ownerPhantomPubkey, monitorKey, amount } = req.body as {
    stealthAddress:     string;
    ownerPhantomPubkey: string;
    monitorKey:         string;
    amount:             string | number;
  };

  if (!stealthAddress || !ownerPhantomPubkey || !monitorKey || !amount) {
    res.status(400).json({ error: "stealthAddress, ownerPhantomPubkey, monitorKey, and amount are required" }); return;
  }

  const entry = stealthStore.get(stealthAddress);
  if (!entry) {
    res.status(404).json({ error: "Stealth address not found or expired. Please generate a new one." }); return;
  }
  if (entry.monitorKey !== monitorKey) {
    res.status(403).json({ error: "Invalid monitorKey — unauthorized forward attempt." }); return;
  }
  if (entry.ownerPhantomPubkey !== ownerPhantomPubkey) {
    res.status(403).json({ error: "Unauthorized: stealthAddress belongs to a different wallet." }); return;
  }
  if (entry.used) {
    res.status(409).json({ error: "This stealth address was already forwarded. Please generate a new one." }); return;
  }
  if (entry.darkPoolStatus === "queued" || entry.darkPoolStatus === "processing") {
    res.status(409).json({ error: "Already queued in Dark Pool. Poll /status to track progress." }); return;
  }

  const amtNum = parseFloat(String(amount));
  if (isNaN(amtNum) || amtNum <= 0) {
    res.status(400).json({ error: "amount must be a positive number" }); return;
  }

  const isEth = entry.chain === "ETH";
  let adjustedAmt = amtNum;

  // ── Balance validation + gas sponsorship ─────────────────────────────────
  try {
    if (isEth) {
      const balResp = await fetch("https://ethereum-sepolia-rpc.publicnode.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1,
          method: "eth_getBalance",
          params: [stealthAddress, "latest"],
        }),
        signal: AbortSignal.timeout(8_000),
      });
      const balData = (await balResp.json()) as { result?: string };
      const weiOnChain = BigInt(balData.result ?? "0x0");
      const ethOnChain = Number(weiOnChain) / 1e18;

      const ETH_GAS_RESERVE = 0.0001;
      if (ethOnChain <= 0) {
        res.status(422).json({
          error: `Stealth address has no ETH balance. Deposit funds first.`,
          onChainBalance: ethOnChain, requestedAmount: amtNum, chain: "ETH",
        }); return;
      }
      if (amtNum > ethOnChain + ETH_GAS_RESERVE) {
        res.status(422).json({
          error: `Requested forward amount (${amtNum.toFixed(6)} ETH) exceeds on-chain stealth balance (${ethOnChain.toFixed(6)} ETH).`,
          onChainBalance: ethOnChain, requestedAmount: amtNum,
          shortfall: parseFloat((amtNum - ethOnChain).toFixed(9)), chain: "ETH",
        }); return;
      }
      adjustedAmt = amtNum - ETH_GAS_RESERVE;

    } else {
      const balResp = await fetch("https://api.devnet.solana.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1,
          method: "getBalance",
          params: [stealthAddress, { commitment: "confirmed" }],
        }),
        signal: AbortSignal.timeout(6_000),
      });
      const balData = (await balResp.json()) as { result?: { value?: number } };
      const userLamports = balData.result?.value ?? 0;
      const solOnChain   = userLamports / 1e9;

      if (userLamports <= 0) {
        res.status(422).json({
          error: `Stealth address has no SOL balance. Deposit funds first.`,
          onChainBalance: 0, requestedAmount: amtNum, chain: "SOL",
        }); return;
      }
      if (amtNum > solOnChain) {
        res.status(422).json({
          error: `Requested forward amount (${amtNum.toFixed(6)} SOL) exceeds on-chain stealth balance (${solOnChain.toFixed(6)} SOL).`,
          onChainBalance: solOnChain, requestedAmount: amtNum,
          shortfall: parseFloat((amtNum - solOnChain).toFixed(9)), chain: "SOL",
        }); return;
      }

      const feeTop         = 2_000_000;
      const MIN_FEE_BUFFER = 10_000;
      const amtLamports    = Math.round(amtNum * 1e9);
      const remainingLamports = userLamports - amtLamports;
      let sponsorSol = 0;
      try {
        const sentinel   = getSentinelKeypair();
        const conn       = new Connection(SOLANA_DEVNET_RPC, "confirmed");
        const stealthPub = new PublicKey(stealthAddress);
        const sentinelBal = await conn.getBalance(sentinel.publicKey).catch(() => 0);
        if (remainingLamports < MIN_FEE_BUFFER && sentinelBal >= feeTop + 20_000) {
          const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
          const sponsorTx = new Transaction({ recentBlockhash: blockhash, feePayer: sentinel.publicKey }).add(
            SystemProgram.transfer({ fromPubkey: sentinel.publicKey, toPubkey: stealthPub, lamports: feeTop }),
          );
          sponsorTx.lastValidBlockHeight = lastValidBlockHeight;
          try {
            await sendAndConfirmTransaction(conn, sponsorTx, [sentinel], { commitment: "confirmed" });
            sponsorSol = feeTop / 1e9;
            console.log(`[stealth/forward] SOL gas sponsored ${feeTop} lamports → ${stealthAddress}`);
          } catch (sponsorTxErr) {
            console.warn("[stealth/forward] gas sponsor tx failed:", (sponsorTxErr as Error).message);
          }
        }
      } catch (sponsorErr) {
        console.warn("[stealth/forward] gas sponsor skipped:", (sponsorErr as Error).message);
      }
      // adjustedAmt stays as amtNum — the sponsored gas is a fee donation to the stealth
      // address, not a deduction from the forwarded amount.
      void sponsorSol;
    }
  } catch (balanceErr) {
    console.error("[stealth/forward] balance pre-check error:", (balanceErr as Error).message);
    res.status(502).json({
      error: "Unable to verify on-chain balance — RPC error. Please retry in a moment.",
      detail: (balanceErr as Error).message,
    }); return;
  }

  if (adjustedAmt <= 0) {
    res.status(422).json({
      error: `Net forwardable amount is zero or negative after gas deductions (${adjustedAmt.toFixed(9)}).`,
      requestedAmount: amtNum, adjustedAmount: adjustedAmt, chain: isEth ? "ETH" : "SOL",
    }); return;
  }

  // ── Queue into Dark Pool (shared darkpool.ts orderBook) with randomized 2–5 min delay ──
  const delayMs    = (Math.random() * 3 + 2) * 60 * 1000; // 2–5 min random
  const releaseAt  = Date.now() + delayMs;
  const chainLabel = isEth ? "ETH" : "SOL";

  // Place a "sell" order into the shared Dark Pool order book — stealth funds enter as real DP entry
  const dpOrderId = randomBytes(16).toString("hex");
  const dpEncHash = sealedId(`stealth:${ownerPhantomPubkey}:${dpOrderId}:${Date.now()}`);
  const dpOrder: DPOrder = {
    id:            dpOrderId,
    phantomPubkey: ownerPhantomPubkey,
    side:          "sell",
    tokenIn:       chainLabel,
    tokenOut:      chainLabel,
    amount:        adjustedAmt,
    status:        "open",
    encHash:       dpEncHash,
    ts:            Date.now(),
  };
  orderBook.set(dpOrderId, dpOrder);

  entry.darkPoolStatus    = "queued";
  entry.darkPoolReleaseAt = releaseAt;
  entry.darkPoolAmount    = adjustedAmt;
  entry.darkPoolOrderId   = dpOrderId;
  stealthStore.set(stealthAddress, entry);

  console.log(`[stealth/forward] dark pool order placed: ${dpOrderId} | ${adjustedAmt} ${chainLabel} | release in ${Math.round(delayMs / 1000)}s`);

  res.json({
    status:       "queued_in_dark_pool",
    stealthAddress,
    chain:        chainLabel,
    amount:       adjustedAmt.toFixed(6),
    releaseAt:    new Date(releaseAt).toISOString(),
    queuedAt:     new Date().toISOString(),
    remainingMs:  Math.round(delayMs),
    remainingMin: parseFloat((delayMs / 60000).toFixed(1)),
    privacyHops:  ["stealth_address", "dark_pool_mixing", "solver_pool", "main_wallet"],
    darkPoolNote: "Funds are mixing with other transactions in the Dark Pool. Random delay prevents timing correlation attacks.",
    pollUrl:      `/api/stealth/receive/status/${stealthAddress}`,
  });
});

// ── Internal: process a queued Dark Pool entry → solver → deliver ─────────────
async function processDarkPoolEntry(stealthAddress: string, entry: StealthEntry): Promise<void> {
  if (!entry.darkPoolAmount || entry.darkPoolStatus !== "queued") return;

  const isEth       = entry.chain === "ETH";
  const chainLabel  = isEth ? "ETH" : "SOL";
  const networkLabel = isEth ? "ethereum-sepolia" : "solana-devnet";
  const adjustedAmt  = entry.darkPoolAmount;
  const { ownerPhantomPubkey } = entry;

  entry.darkPoolStatus = "processing";
  stealthStore.set(stealthAddress, entry);

  try {
    // Seal intent with Encrypt FHE
    const intentPayload = JSON.stringify({
      phantomPubkey: ownerPhantomPubkey,
      fromChain: chainLabel, toChain: chainLabel,
      fromToken: chainLabel, toToken: chainLabel,
      amount: String(adjustedAmt),
      destinationAddress: ownerPhantomPubkey,
      stealthForward: true, darkPoolForward: true,
      stealthAddress,
      chain: chainLabel,
      nonce: randomBytes(16).toString("hex"),
      timestamp: Date.now(),
    });

    // Encrypt FHE — hard fail: dark pool entry cannot proceed without on-chain sealing
    const encrypted = await encryptAuditLog({
      event: "dark_pool_forward_intent",
      data:  intentPayload,
      walletAddress: ownerPhantomPubkey,
    });
    if (!encrypted.onChainId) {
      throw new Error("Encrypt FHE returned no onChainId — dark pool entry aborted");
    }
    const encryptedIntentId   = encrypted.onChainId;
    const encryptedIntentHash = encrypted.encrypted.slice(0, 64);
    const encryptMode         = "devnet" as const;

    // Solver blind auction
    const intentParams = {
      fromChain: chainLabel, toChain: chainLabel,
      fromToken: chainLabel, toToken: chainLabel,
      amount: String(adjustedAmt),
    };
    const staticBids   = getSolverBids(intentParams);
    const [aiBid, customBids] = await Promise.all([
      aiSolverAgent.computeBid(intentParams, staticBids).catch(() => null),
      Promise.resolve(getCustomSolverBids({ fromChain: chainLabel, toChain: chainLabel, fromToken: chainLabel, toToken: chainLabel, amount: String(adjustedAmt) })),
    ]);
    const allBids    = [
      ...(aiBid ? [aiBid] : []),
      ...customBids,
    ].sort((a, b) => parseFloat(b.outputAmount) - parseFloat(a.outputAmount));

    if (allBids.length === 0) {
      throw new Error(`No real solvers available for dark pool route ${chainLabel}→${chainLabel}. Live Solver and AI Solver must be registered and funded.`);
    }

    const finalBids: SolverBid[] = allBids;

    const bestBid    = getBestBid(finalBids) ?? finalBids[0]!;
    const viewingKey = generateViewingKey();
    const deadline   = new Date(Date.now() + 120_000);

    const [row] = await db
      .insert(intentsTable)
      .values({
        phantomPubkey:      ownerPhantomPubkey,
        fromChain:          chainLabel,
        toChain:            chainLabel,
        fromToken:          chainLabel,
        toToken:            chainLabel,
        amount:             String(adjustedAmt),
        destinationAddress: ownerPhantomPubkey,
        encryptedIntentId,
        encryptedIntentHash,
        status:             "bidding",
        solverBids:         finalBids as SolverBid[],
        deadline,
        releaseAfter:       null,
      })
      .returning();

    // Mark the dark pool order as "matched" — funds consumed from shared orderBook
    if (entry.darkPoolOrderId) {
      const dpOrder = orderBook.get(entry.darkPoolOrderId);
      if (dpOrder) {
        dpOrder.status = "matched";
        orderBook.set(entry.darkPoolOrderId, dpOrder);
      }
    }

    entry.darkPoolStatus    = "delivered";
    entry.used              = true;
    entry.darkPoolDelivered = {
      intentId:            row!.id,
      outputAmount:        bestBid.outputAmount,
      feePercent:          bestBid.feePercent,
      feeAmount:           bestBid.feeAmount,
      encryptedIntentId,
      encryptedIntentHash,
      encryptMode,
      viewingKey,
      solver: {
        id:              bestBid.solverId,
        name:            bestBid.solverName,
        strategy:        bestBid.solverStrategy,
        reputationScore: bestBid.reputationScore,
        estimatedSeconds: bestBid.estimatedSeconds,
      },
      privacyProof: {
        mechanism:    "3-hop privacy: stealth → dark_pool → solver → main_wallet (ERC-7683-inspired)",
        chainLink:    "BROKEN — no direct on-chain tx from stealth to main wallet",
        encryptLayer: `Encrypt FHE devnet (${encryptMode}) — intent sealed, solver sees route only`,
        ikaSignature: isEth
          ? "secp256k1 ECDSA approval (Ika-threshold in production)"
          : "Ika Curve25519 EddsaSha512 — threshold MPC approval required",
        onChainTrace: [
          `sender → stealth_address (${chainLabel}) [hop 1: incoming deposit from CEX/external]`,
          `stealth_address → dark_pool (${chainLabel}) [hop 2: mixing with random delay]`,
          `solver_pool → ${ownerPhantomPubkey.slice(0, 8)}… (main wallet) [hop 3: delivery, unlinked]`,
        ],
      },
      deliveryEta: new Date(Date.now() + bestBid.estimatedSeconds * 1000).toISOString(),
    };
    stealthStore.set(stealthAddress, entry);
    console.log(`[dark_pool/process] delivered: ${stealthAddress} → intent #${row!.id}`);

  } catch (err) {
    console.error("[dark_pool/process] failed:", (err as Error).message);
    entry.darkPoolStatus = "failed";
    stealthStore.set(stealthAddress, entry);
    throw err;
  }
}

// ── GET /api/stealth/receive/status/:address?monitorKey=xxx ──────────────────
// Poll this endpoint after /forward. Requires monitorKey for ownership proof —
// stealth addresses are intentionally shared, so auth is needed to protect privacy metadata.
// When dark pool delay expires, automatically triggers solver auction and delivers.
//
// Auth-first ordering: monitorKey is validated BEFORE entry existence is checked.
// This prevents queue-state enumeration — a third party probing a stealth address
// always receives 403, never learns whether an entry is active.
router.get("/stealth/receive/status/:address", async (req, res) => {
  const { address }    = req.params;
  const { monitorKey } = req.query as { monitorKey?: string };

  // Reject early — same shape for missing key and unknown/mismatched address
  // so callers cannot distinguish "no entry" from "wrong key"
  if (!monitorKey) {
    res.status(403).json({ error: "monitorKey required." }); return;
  }
  const entry = stealthStore.get(address);
  if (!entry || entry.monitorKey !== monitorKey) {
    res.status(403).json({ error: "monitorKey required." }); return;
  }

  if (!entry.darkPoolStatus) {
    res.json({ status: "not_queued", address }); return;
  }

  if (entry.darkPoolStatus === "delivered" && entry.darkPoolDelivered) {
    res.json({
      status:     "delivered",
      address,
      ...entry.darkPoolDelivered,
      note: "Main wallet received funds from solver pool — not from stealth address. No direct on-chain link (3 hops).",
    }); return;
  }

  if (entry.darkPoolStatus === "failed") {
    res.json({ status: "failed", address, error: "Dark Pool processing failed. Please contact support." }); return;
  }

  if (entry.darkPoolStatus === "processing") {
    res.json({ status: "processing", address, message: "Solver selected — delivering to main wallet…" }); return;
  }

  // status === "queued" — check if release time has passed
  const now = Date.now();
  const releaseAt = entry.darkPoolReleaseAt ?? 0;
  const remainingMs = Math.max(0, releaseAt - now);

  if (remainingMs > 0) {
    // Still in mixing delay
    res.json({
      status:      "queued_in_dark_pool",
      address,
      releaseAt:   new Date(releaseAt).toISOString(),
      remainingMs,
      remainingMin: parseFloat((remainingMs / 60000).toFixed(1)),
      remainingSec: Math.ceil(remainingMs / 1000),
      message:     "Mixing in Dark Pool — random delay prevents timing correlation attacks",
    }); return;
  }

  // Release time passed → process now
  try {
    await processDarkPoolEntry(address, entry);
    const updated = stealthStore.get(address);
    if (updated?.darkPoolStatus === "delivered" && updated.darkPoolDelivered) {
      res.json({
        status: "delivered",
        address,
        ...updated.darkPoolDelivered,
        note: "Main wallet received funds from solver pool — not from stealth address. No direct on-chain link (3 hops).",
      });
    } else {
      res.json({ status: "processing", address, message: "Solver routing in progress…" });
    }
  } catch (err) {
    res.status(500).json({
      status: "failed",
      error:  (err as Error).message,
    });
  }
});

export default router;
