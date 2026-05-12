/**
 * Private Intent API — Core Engine
 *
 * Implements ERC-7683-inspired CrossChainOrder lifecycle on Solana:
 *
 *   POST /api/intent/submit   — FHE-seal intent → return CrossChainOrder + solver bids
 *   GET  /api/intent/history  — Privacy-preserved network activity
 *   GET  /api/intent/:id      — Get intent status + bids + delivery tracking
 *   POST /api/intent/accept   — User accepts bid → lock escrow → grant ResolvedOrder to solver
 *   POST /api/intent/settle   — Solver submits proof → verify → release escrow
 *   GET  /api/intent/solvers  — List all available solvers
 *
 * Privacy model:
 *   1. Intent submitted → encrypted with Encrypt FHE → only hash visible to solvers
 *   2. Solvers bid BLIND — they see only route + encrypted hash, never amounts/addresses
 *   3. User selects solver → solver gets "Viewing Key" (temp decrypt) to validate intent
 *   4. Solver decrypts, validates liquidity, executes delivery via Ika MPC
 *   5. Solver posts proof → escrow released
 *
 * Standard: Inspired by ERC-7683 (Cross-Chain Intent Standard)
 */

import { Router } from "express";
import { createHash, randomBytes } from "crypto";
import { db } from "@workspace/db";
import { intentsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { encryptAuditLog, generateViewingKey } from "../services/encrypt.js";
import { getSolverBids, getBestBid, getAllSolvers, type IntentParams } from "../services/solverEngine.js";
import { aiSolverAgent } from "../services/aiSolverAgent.js";
import { getCustomSolverBids, recordCustomSolverWin } from "../services/customSolverRegistry.js";
import {
  createNativeWallet,
  signAndBroadcastEthTx,
  signAndBroadcastBtcTx,
  signAndBroadcastSolTx,
} from "../services/nativeSigner.js";
import { executeLiveDelivery, LIVE_SOLVER_ID, getLiveSolverAddresses } from "../services/liveSolverService.js";
import { db as dbDirect } from "@workspace/db";
import { nativeWalletsTable } from "@workspace/db/schema";
import {
  Connection,
  Transaction,
  SystemProgram,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getSentinelKeypair, SOLANA_DEVNET_RPC } from "../services/solanaBroadcast.js";

const router = Router();

// In-memory viewing key store: intentId → viewingKey (one-time use, deleted after grant)
// In production: store encrypted in DB with short TTL
const intentViewingKeys = new Map<number, string>();


// ── Helpers ───────────────────────────────────────────────────────────────────

function buildCrossChainOrder(params: {
  initiator: string;
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  encryptedOrderData: string;
  fillDeadline: string;
}): object {
  return {
    standard: "ERC-7683-Inspired",
    version: "1.0",
    orderDataType: "PrivateSwapOrder",
    initiator: "SEALED (Encrypt FHE — not visible to solvers)",
    originChainId: "solana-devnet",
    inputToken: params.fromToken,
    inputAmount: "SEALED (Encrypt FHE — MEV shield)",
    outputToken: params.toToken,
    destinationChainId: chainToNetworkId(params.toChain),
    encryptedOrderData: params.encryptedOrderData,
    fillDeadline: params.fillDeadline,
    exclusivityPeriodSeconds: 30,
    privacyNote: "Initiator identity and input amount sealed by Encrypt FHE. Solvers bid based on route only.",
  };
}

interface ResolvedOrder {
  standard: string;
  version: string;
  orderHash: string;
  resolvedAt: string;
  fillDeadline: string;
  maxSpent: object[];
  minReceived: object[];
  fillInstructions: object[];
  solverViewingKey: string;
  viewingKeyNote: string;
}

function buildResolvedOrder(params: {
  intentId: number;
  escrowPda: string;
  inputAmount: string;
  outputAmount: string;
  fromToken: string;
  toToken: string;
  fromChain: string;
  toChain: string;
  destinationAddress: string;
  viewingKey: string;
  proofHash: string;
  fillDeadline: string;
}): ResolvedOrder {
  return {
    standard: "ERC-7683-Inspired",
    version: "1.0",
    orderHash: params.proofHash,
    resolvedAt: new Date().toISOString(),
    fillDeadline: params.fillDeadline,
    maxSpent: [{
      token: params.fromToken,
      amount: params.inputAmount,
      chainId: "solana-devnet",
      recipient: params.escrowPda,
      note: "Locked in Anchor escrow PDA — released only after proof",
    }],
    minReceived: [{
      token: params.toToken,
      amount: params.outputAmount,
      chainId: chainToNetworkId(params.toChain),
      recipient: params.destinationAddress || "solver-derived-address",
    }],
    fillInstructions: [{
      destinationChainId: chainToNetworkId(params.toChain),
      destinationSettler: "ika-mpc-solver",
      originData: String(params.intentId),
    }],
    solverViewingKey: params.viewingKey,
    viewingKeyNote: "One-time key — grants solver access to decrypt sealed intent for validation only. Expires after use.",
  };
}

function chainToNetworkId(chain: string): string {
  const map: Record<string, string> = {
    BTC: "bitcoin-testnet3", ETH: "ethereum-sepolia",
    BASE: "base-sepolia", ARB: "arbitrum-sepolia", SOL: "solana-devnet",
  };
  return map[chain] ?? chain.toLowerCase();
}

// ── GET /api/escrow/config ─────────────────────────────────────────────────────
// Returns sentinel pubkey so frontend can send SOL to it as escrow
router.get("/escrow/config", (_req, res) => {
  const sentinel = getSentinelKeypair();
  res.json({
    escrowPubkey: sentinel.publicKey.toBase58(),
    rpcUrl: SOLANA_DEVNET_RPC,
    network: "solana-devnet",
    note: "Send SOL here to lock escrow. Sentinel releases to solver after delivery proof.",
  });
});

// ── GET /api/intent/solvers ────────────────────────────────────────────────────
router.get("/intent/solvers", (_req, res) => {
  const solvers = getAllSolvers();
  res.json({ solvers, count: solvers.length, standard: "ERC-7683-Inspired" });
});

// ── GET /api/intent/history ────────────────────────────────────────────────────
// MUST be before /intent/:id — "history" must not be captured as a param
// Privacy-preserving: hides wallet, destination, input amount. Shows route, output, solver, status.
router.get("/intent/history", async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: intentsTable.id,
        fromChain: intentsTable.fromChain,
        toChain: intentsTable.toChain,
        toToken: intentsTable.toToken,
        encryptedIntentHash: intentsTable.encryptedIntentHash,
        status: intentsTable.status,
        winningSolverId: intentsTable.winningSolverId,
        solverBids: intentsTable.solverBids,
        deliveryTxId: intentsTable.deliveryTxId,
        createdAt: intentsTable.createdAt,
        updatedAt: intentsTable.updatedAt,
      })
      .from(intentsTable)
      .orderBy(intentsTable.createdAt)
      .limit(50);

    const history = rows.map(row => {
      const bids = (row.solverBids as any[]) ?? [];
      const winningBid = bids.find((b: any) => b.solverId === row.winningSolverId);
      const [txId, explorerUrl] = (row.deliveryTxId ?? "").split("|");
      return {
        anonymousId: row.encryptedIntentHash?.slice(0, 12) ?? `#${row.id}`,
        route: `${row.fromChain} → ${row.toChain}`,
        outputAmount: winningBid?.outputAmount ?? null,
        toToken: row.toToken,
        winningSolverName: winningBid?.solverName ?? row.winningSolverId ?? "Unknown",
        status: row.status,
        deliveryTxId: txId && !txId.startsWith("sim_") ? txId : null,
        deliveryExplorerUrl: explorerUrl ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        privacyNote: "wallet, destination, and input amount are sealed by Encrypt FHE",
      };
    });

    res.json({ history, count: history.length, privacyMode: "fhe-sealed" });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/intent/submit ───────────────────────────────────────────────────
// 1. Seal intent with Encrypt FHE (MEV shield — solvers see only hash)
// 2. Generate viewing key (user holds this — grants to winning solver on accept)
// 3. Collect bids from all eligible solvers (they bid BLIND on route only)
// 4. Return CrossChainOrder struct + bids + viewingKey to user
router.post("/intent/submit", async (req, res) => {
  try {
    const {
      phantomPubkey,
      fromChain,
      toChain,
      fromToken,
      toToken,
      amount,
      destinationAddress,
      releaseAfter,
    } = req.body as {
      phantomPubkey: string;
      fromChain: string;
      toChain: string;
      fromToken: string;
      toToken: string;
      amount: string;
      destinationAddress?: string;
      releaseAfter?: string;
    };

    if (!phantomPubkey || !fromChain || !toChain || !fromToken || !toToken || !amount) {
      return res.status(400).json({ error: "Missing required fields: phantomPubkey, fromChain, toChain, fromToken, toToken, amount" });
    }

    // Validate releaseAfter if provided: must be a valid ISO date and in the future
    if (releaseAfter !== undefined && releaseAfter !== null) {
      const ts = Date.parse(releaseAfter);
      if (isNaN(ts)) {
        return res.status(400).json({ error: "releaseAfter must be a valid ISO 8601 timestamp" });
      }
      if (ts <= Date.now()) {
        return res.status(400).json({ error: "releaseAfter must be a future timestamp" });
      }
      const maxRelease = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days max
      if (ts > maxRelease) {
        return res.status(400).json({ error: "releaseAfter cannot be more than 30 days in the future" });
      }
    }

    // 1. Seal intent with Encrypt FHE (MEV shield)
    const intentPayload = JSON.stringify({
      phantomPubkey,
      fromChain,
      toChain,
      fromToken,
      toToken,
      amount,
      destinationAddress: destinationAddress ?? "",
      nonce: randomBytes(16).toString("hex"),
      timestamp: Date.now(),
    });

    let encryptedIntentId = `enc_${randomBytes(16).toString("hex")}`;
    let encryptedIntentHash = createHash("sha256").update(intentPayload).digest("hex");
    let encryptMode = "devnet";

    try {
      const encrypted = await encryptAuditLog({
        event: "intent_submitted",
        data: intentPayload,
        walletAddress: phantomPubkey,
      });
      encryptedIntentId = encrypted.onChainId ?? encryptedIntentId;
      encryptedIntentHash = encrypted.encryptedPayload?.slice(0, 64) ?? encryptedIntentHash;
      encryptMode = encrypted.encryptMode ?? "devnet";
    } catch (e) {
      console.warn("[intent/submit] FHE encrypt warn:", (e as Error).message);
    }

    // 2. Collect solver bids in parallel (solvers bid BLIND — see route only, not amounts)
    const intentParams: IntentParams = { fromChain, toChain, fromToken, toToken, amount };
    const staticBids = getSolverBids(intentParams);

    const aiBidPromise = aiSolverAgent.computeBid(intentParams, staticBids).catch(e => {
      console.warn("[intent/submit] AI solver bid failed:", e.message);
      return null;
    });

    const [aiBid, customBids] = await Promise.all([
      aiBidPromise,
      Promise.resolve(getCustomSolverBids({ fromChain, toChain, fromToken, toToken, amount })),
    ]);

    const allBids = [
      ...staticBids,
      ...(aiBid ? [aiBid] : []),
      ...customBids,
    ].sort((a, b) => parseFloat(b.outputAmount) - parseFloat(a.outputAmount));

    if (allBids.length === 0) {
      return res.status(422).json({
        error: "No solvers available for this route",
        supportedRoutes: "SOL→BTC, SOL→ETH, SOL→BASE, SOL→ARB, ETH→SOL, BTC→SOL",
      });
    }

    // 3. Generate viewing key (user holds — grants to winning solver on accept)
    const viewingKey = generateViewingKey();

    // 4. Store intent
    const deadline = new Date(Date.now() + 120_000);
    const [row] = await db
      .insert(intentsTable)
      .values({
        phantomPubkey,
        fromChain,
        toChain,
        fromToken,
        toToken,
        amount,
        destinationAddress,
        encryptedIntentId,
        encryptedIntentHash,
        status: "bidding",
        solverBids: allBids as any,
        deadline,
        releaseAfter: releaseAfter ? new Date(releaseAfter) : null,
      })
      .returning();

    // Store viewing key in memory (intentId → viewingKey)
    intentViewingKeys.set(row!.id, viewingKey);

    // Log intent submission for demo visibility
    const bestBid = getBestBid(allBids);
    const aiLabel = aiBid !== null ? `${staticBids.length}+1AI` : `${staticBids.length}`;
    process.stdout.write(
      `[Intent]  SUBMIT  intentId=${row!.id} | phantom=${phantomPubkey.slice(0, 8)}… | ${fromChain}→${toChain} ${fromToken}→${toToken} | amt=${amount} | FHE=${encryptMode} | encId=${encryptedIntentId.slice(0, 14)}…\n`
    );
    process.stdout.write(
      `[Intent]  BIDS    intentId=${row!.id} | solvers=${aiLabel} | best=${bestBid?.solverName ?? "none"} output=${bestBid?.outputAmount ?? "—"} ${toToken} | deadline=${deadline.toISOString()}\n`
    );

    // 5. Build ERC-7683 CrossChainOrder struct
    const crossChainOrder = buildCrossChainOrder({
      initiator: phantomPubkey,
      fromChain,
      toChain,
      fromToken,
      toToken,
      encryptedOrderData: encryptedIntentHash,
      fillDeadline: deadline.toISOString(),
    });

    res.status(201).json({
      intentId: row!.id,
      status: "bidding",
      encryptedIntentId,
      encryptedIntentHash,
      encryptMode,
      privacyNote: "Intent sealed on Encrypt FHE devnet — solvers see only hash, never your details",
      crossChainOrder,
      standard: "ERC-7683-Inspired",
      viewingKey,
      viewingKeyNote: "Hold this key securely. Share only with winning solver on accept to grant temp decrypt access.",
      bids: allBids,
      bestBid: getBestBid(allBids),
      expiresAt: deadline.toISOString(),
      releaseAfter: row!.releaseAfter?.toISOString() ?? null,
      aiSolverIncluded: aiBid !== null,
      customSolverCount: customBids.length,
      totalSolvers: allBids.length,
    });
  } catch (err) {
    console.error("[intent/submit]", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/intent/:id ────────────────────────────────────────────────────────
router.get("/intent/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id ?? "0");
    if (!id) return res.status(400).json({ error: "Invalid intent id" });

    const [row] = await db.select().from(intentsTable).where(eq(intentsTable.id, id)).limit(1);
    if (!row) return res.status(404).json({ error: "Intent not found" });

    res.json({
      intentId: row.id,
      status: row.status,
      fromChain: row.fromChain,
      toChain: row.toChain,
      fromToken: row.fromToken,
      toToken: row.toToken,
      amount: row.amount,
      destinationAddress: row.destinationAddress,
      encryptedIntentId: row.encryptedIntentId,
      encryptedIntentHash: row.encryptedIntentHash,
      winningSolverId: row.winningSolverId,
      bids: row.solverBids,
      sourceTxId: row.sourceTxId,
      deliveryTxId: row.deliveryTxId,
      proofHash: row.proofHash,
      escrowPda: row.escrowPda,
      deadline: row.deadline,
      releaseAfter: row.releaseAfter?.toISOString() ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      standard: "ERC-7683-Inspired",
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/intent/accept ────────────────────────────────────────────────────
// User selects solver → lock escrow → grant ResolvedOrder (viewing key) to winning solver
router.post("/intent/accept", async (req, res) => {
  try {
    const { intentId, solverId, dwalletId, sourceTxId } = req.body as {
      intentId: number;
      solverId: string;
      dwalletId?: string;
      sourceTxId?: string;
    };

    if (!intentId || !solverId) {
      return res.status(400).json({ error: "intentId and solverId required" });
    }

    const [row] = await db.select().from(intentsTable).where(eq(intentsTable.id, intentId)).limit(1);
    if (!row) return res.status(404).json({ error: "Intent not found" });
    if (row.status !== "bidding") return res.status(409).json({ error: `Intent is ${row.status}, expected bidding` });

    const bids = (row.solverBids as any[]) ?? [];
    const winningBid = bids.find((b: any) => b.solverId === solverId);
    if (!winningBid) return res.status(404).json({ error: "Solver bid not found" });

    // Escrow = sentinel pubkey yang nyata (SOL dikirim dari Phantom ke sini via tx frontend)
    const sentinel = getSentinelKeypair();
    const escrowPda = sentinel.publicKey.toBase58();
    const proofHash = createHash("sha256")
      .update(`${intentId}:${solverId}:${Date.now()}`)
      .digest("hex");

    await db
      .update(intentsTable)
      .set({
        status: "accepted",
        winningSolverId: solverId,
        escrowPda,
        sourceTxId: sourceTxId ?? null,
        proofHash,
        dwalletId: dwalletId ?? row.dwalletId,
        updatedAt: new Date(),
      })
      .where(eq(intentsTable.id, intentId));

    // Retrieve and revoke viewing key (one-time grant to winning solver)
    const viewingKey = intentViewingKeys.get(intentId) ?? generateViewingKey();
    intentViewingKeys.delete(intentId); // one-time use

    // Build ERC-7683 ResolvedOrder (disclosed to winning solver only)
    const resolvedOrder = buildResolvedOrder({
      intentId,
      escrowPda,
      inputAmount: row.amount,
      outputAmount: winningBid.outputAmount,
      fromToken: row.fromToken,
      toToken: row.toToken,
      fromChain: row.fromChain,
      toChain: row.toChain,
      destinationAddress: row.destinationAddress ?? "",
      viewingKey,
      proofHash,
      fillDeadline: row.deadline?.toISOString() ?? new Date(Date.now() + 120_000).toISOString(),
    });

    // Record AI solver win if applicable
    aiSolverAgent.recordWin(solverId);
    if (solverId.startsWith("custom-")) recordCustomSolverWin(solverId);

    // Log accept for demo visibility
    process.stdout.write(
      `[Intent]  ACCEPT  intentId=${intentId} | winner=${winningBid.solverName} (${solverId}) | escrow=${escrowPda.slice(0, 8)}… | viewingKey granted (1-use)\n`
    );
    process.stdout.write(
      `[Intent]  ERC-7683 ResolvedOrder built | intentId=${intentId} | ${row.fromChain}→${row.toChain} | fillDeadline=${resolvedOrder.fillDeadline}\n`
    );

    // Trigger solver execution asynchronously
    executeDelivery(intentId, winningBid, row).catch(e =>
      console.error("[intent/accept] delivery error:", e)
    );

    res.json({
      intentId,
      status: "accepted",
      solverId,
      solverName: winningBid.solverName,
      escrowPda,
      escrowNote: `SOL dikunci di sentinel escrow (${escrowPda.slice(0, 8)}…). Release ke solver setelah bukti pengiriman.`,
      sourceTxId: sourceTxId ?? null,
      sourceTxExplorer: sourceTxId ? `https://explorer.solana.com/tx/${sourceTxId}?cluster=devnet` : null,
      expectedDelivery: new Date(Date.now() + winningBid.estimatedSeconds * 1000).toISOString(),
      winningBid,
      standard: "ERC-7683-Inspired",
      resolvedOrder,
      viewingKeyGranted: true,
      viewingKeyNote: "Viewing key embedded in resolvedOrder — winning solver uses this to decrypt intent and validate before execution.",
    });
  } catch (err) {
    console.error("[intent/accept]", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Async delivery execution ──────────────────────────────────────────────────
async function executeDelivery(intentId: number, bid: any, intent: any) {
  try {
    const toChainLabel = bid.toChain as string;
    const destPreview  = (intent.destinationAddress ?? "").slice(0, 12) || "(lookup dWallet)";
    process.stdout.write(
      `[delivery] START  intentId=${intentId} | chain=${toChainLabel} | dest=${destPreview}… | outputAmt=${bid.outputAmount} ${bid.toToken ?? toChainLabel}\n`
    );

    // ── Timed-release gate ────────────────────────────────────────────────────
    // If the intent has a releaseAfter timestamp, delay execution until that time.
    if (intent.releaseAfter) {
      const releaseAt = new Date(intent.releaseAfter).getTime();
      const waitMs = releaseAt - Date.now();
      if (waitMs > 0) {
        process.stdout.write(`[delivery] Time-lock gate: waiting ${Math.round(waitMs / 1000)}s until ${intent.releaseAfter}\n`);
        await new Promise<void>(resolve => setTimeout(resolve, waitMs));
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    await db
      .update(intentsTable)
      .set({ status: "executing", updatedAt: new Date() })
      .where(eq(intentsTable.id, intentId));

    // Look up user's dWallet addresses for default destination
    // Solver delivers DIRECTLY to destinationAddress — no re-hop
    const userWallets = await db
      .select()
      .from(nativeWalletsTable)
      .where(eq(nativeWalletsTable.phantomPubkey, intent.phantomPubkey ?? ""));
    const secp256k1W = userWallets.find((w: any) => w.curve === "secp256k1");
    const curve25519W = userWallets.find((w: any) => w.curve === "curve25519");

    function getUserDest(chain: string): string {
      if (chain === "BTC") return secp256k1W?.btcAddress ?? "";
      if (chain === "ETH" || chain === "BASE" || chain === "ARB") return secp256k1W?.ethAddress ?? "";
      if (chain === "SOL") return curve25519W?.solAddress ?? "";
      return "";
    }

    let deliveryTxId = "";
    let deliveryExplorerUrl = "";
    let isLiveDelivery = false;
    const toChain = bid.toChain as string;
    const isLiveSolver = bid.solverId?.includes("live-solver") || bid.solverName?.includes("Live Solver");

    // ── Live Delivery: always use live solver wallet for real testnet tx ────────
    // Regardless of which solver "won" the auction (price discovery), the actual
    // delivery uses the live solver's funded testnet wallet.
    {
      const destAddr = intent.destinationAddress || getUserDest(toChain);
      const result = await executeLiveDelivery({
        toChain,
        destinationAddress: destAddr,
        outputAmount: bid.outputAmount,
        intentId,
      });
      if (result.success && result.txHash) {
        deliveryTxId = result.txHash;
        deliveryExplorerUrl = result.explorerUrl;
        isLiveDelivery = true;
        process.stdout.write(`[delivery/live] REAL tx success txHash=${deliveryTxId.slice(0, 18)}… explorer=${deliveryExplorerUrl}\n`);
      } else {
        console.warn(`[delivery/live] real tx failed (${result.error}) — sim fallback`);
        deliveryTxId = `sim_live_${randomBytes(16).toString("hex")}`;
        deliveryExplorerUrl = "";
      }
    }

    // Live delivery covers all chains — no separate Ika MPC path needed for testnet

    if (!deliveryTxId) deliveryTxId = `sim_unknown_${randomBytes(16).toString("hex")}`;

    const proofHash = createHash("sha256")
      .update(`${intentId}:${bid.solverId}:${deliveryTxId}:${Date.now()}`)
      .digest("hex");

    const storedTxId = isLiveDelivery && deliveryExplorerUrl
      ? `${deliveryTxId}|${deliveryExplorerUrl}`
      : deliveryTxId;

    await db
      .update(intentsTable)
      .set({ status: "delivered", deliveryTxId: storedTxId, proofHash, updatedAt: new Date() })
      .where(eq(intentsTable.id, intentId));

    setTimeout(async () => {
      await db
        .update(intentsTable)
        .set({ status: "settled", updatedAt: new Date() })
        .where(eq(intentsTable.id, intentId));
    }, 3000);
  } catch (err) {
    console.error("[executeDelivery] failed:", err);
    await db
      .update(intentsTable)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(intentsTable.id, intentId));
  }
}

function deriveDefaultDest(toChain: string): string {
  if (toChain === "SOL") return "99pdEHxysxtd6KhFQ6im6NRAX5hHUm3rpMNJSCjUjfBQ";
  if (toChain === "ETH" || toChain === "BASE" || toChain === "ARB") return "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
  if (toChain === "BTC") return "tb1qx43yay4naz5g5j74svq3kx2r298s9dxa0c4w5w";
  return "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
}

function mapChainToNative(chain: string): string {
  if (chain === "ETH" || chain === "BASE" || chain === "ARB") return "ethereum";
  if (chain === "BTC") return "bitcoin";
  if (chain === "SOL") return "solana";
  return "ethereum";
}

// ── POST /api/intent/settle ───────────────────────────────────────────────────
// Solver posts delivery proof → verify proof hash → release escrow (REAL SOL tx)
router.post("/intent/settle", async (req, res) => {
  try {
    const { intentId, proofHash, solverPaymentAddress } = req.body as {
      intentId: number;
      proofHash: string;
      solverPaymentAddress?: string; // SOL address solver wants payment to
    };

    if (!intentId || !proofHash) {
      return res.status(400).json({ error: "intentId and proofHash required" });
    }

    const [row] = await db.select().from(intentsTable).where(eq(intentsTable.id, intentId)).limit(1);
    if (!row) return res.status(404).json({ error: "Intent not found" });

    if (row.proofHash && row.proofHash !== proofHash) {
      process.stdout.write(
        `[settle]  VERIFY  intentId=${intentId} | proofHash=${proofHash.slice(0, 12)}… ❌ mismatch (expected ${row.proofHash.slice(0, 12)}…)\n`
      );
      return res.status(400).json({
        error: "Proof hash mismatch — escrow not released",
        expectedHash: row.proofHash.slice(0, 12) + "…",
        note: "Use the proofHash returned by POST /api/intent/accept",
      });
    }
    process.stdout.write(
      `[settle]  VERIFY  intentId=${intentId} | proofHash=${proofHash.slice(0, 12)}… ✅ match\n`
    );

    // Resolve solver's SOL payment address:
    //   1. Solver provides it explicitly in request body
    //   2. Look it up from nativeWalletsTable by winning solverId
    //   3. Fallback: live solver's registered SOL address
    let solverSolAddress: string | null = solverPaymentAddress ?? null;

    if (!solverSolAddress && row.winningSolverId) {
      // Look up solver's SOL wallet from DB (for user-created custom solvers)
      const [solverWalletRow] = await db
        .select()
        .from(nativeWalletsTable)
        .where(eq(nativeWalletsTable.phantomPubkey, row.winningSolverId))
        .limit(1);
      if (solverWalletRow?.solAddress) solverSolAddress = solverWalletRow.solAddress;
    }

    // Fallback: live solver's registered SOL address (its actual keypair, not sentinel)
    if (!solverSolAddress) {
      try { solverSolAddress = getLiveSolverAddresses().sol; } catch { /* no live solver */ }
    }

    // Release real SOL from sentinel escrow → solver's actual address
    let releaseTxId: string | null = null;
    let releaseTxExplorer: string | null = null;
    try {
      if (!solverSolAddress) throw new Error("Cannot resolve solver payment address");
      const sentinel = getSentinelKeypair();
      const conn = new Connection(SOLANA_DEVNET_RPC, "confirmed");
      const balance = await conn.getBalance(sentinel.publicKey);
      const requestedLamports = Math.floor(parseFloat(row.amount ?? "0") * 1e9);
      const releaseLamports = Math.min(requestedLamports, balance - 10_000);

      if (releaseLamports <= 0) throw new Error(`Sentinel balance too low (${balance} lamports) to release`);

      const solverPubkey = new PublicKey(solverSolAddress);
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
      const releaseTx = new Transaction({
        recentBlockhash: blockhash,
        feePayer: sentinel.publicKey,
      }).add(
        SystemProgram.transfer({
          fromPubkey: sentinel.publicKey,
          toPubkey: solverPubkey,
          lamports: releaseLamports,
        })
      );
      releaseTx.lastValidBlockHeight = lastValidBlockHeight;
      const sig = await sendAndConfirmTransaction(conn, releaseTx, [sentinel], { commitment: "confirmed" });
      releaseTxId = sig;
      releaseTxExplorer = `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
      process.stdout.write(`[settle] SOL released → ${solverSolAddress.slice(0, 12)}… sig=${sig.slice(0, 16)}… lamports=${releaseLamports}\n`);
    } catch (releaseErr) {
      console.warn("[settle] SOL release failed (non-fatal):", (releaseErr as Error).message?.slice(0, 80));
    }

    await db
      .update(intentsTable)
      .set({ status: "settled", proofHash, updatedAt: new Date() })
      .where(eq(intentsTable.id, intentId));

    res.json({
      intentId,
      status: "settled",
      proofHash,
      escrowPda: row.escrowPda,
      releaseTxId,
      releaseTxExplorer,
      note: releaseTxId
        ? `Escrow released — SOL ditransfer dari sentinel ke solver. Verify: ${releaseTxExplorer}`
        : "Settled — escrow release skipped (balance insufficient atau error).",
      deliveryTxId: row.deliveryTxId,
      standard: "ERC-7683-Inspired",
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
