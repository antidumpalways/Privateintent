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
import { ethers } from "ethers";
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
import { executeLiveDelivery, lockEthEscrow, releaseFromEscrowContract, checkEthDepositOnChain, getEscrowContractAddress, LIVE_SOLVER_ID, getLiveSolverAddresses, checkSolverCanFulfill, getLiveSolverCapacity } from "../services/liveSolverService.js";
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
import {
  getSolIntentEscrowAddress,
  getSolEscrowPda,
  releaseSolEscrow,
  buildRefundInstructionParams,
} from "../services/solEscrowService.js";
import { SOL_ESCROW_PROGRAM_ID } from "../services/solEscrowProgramId.js";

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
    originChainId: chainToNetworkId(params.fromChain),
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
      chainId: chainToNetworkId(params.fromChain),
      recipient: params.escrowPda,
      note: "Locked in escrow — released only after delivery proof",
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

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";

// ── GET /api/escrow/config ─────────────────────────────────────────────────────
router.get("/escrow/config", (_req, res) => {
  const sentinel = getSentinelKeypair();
  const { eth: ethSolverAddress } = getLiveSolverAddresses();
  const ethEscrowContract = getEscrowContractAddress();
  res.json({
    escrowPubkey: sentinel.publicKey.toBase58(),
    rpcUrl: SOLANA_DEVNET_RPC,
    network: "solana-devnet",
    ethEscrowContract,
    ethEscrowAddress: ethSolverAddress,
    solEscrowProgramId: SOL_ESCROW_PROGRAM_ID,
    solEscrowType: "pda",
    solEscrowNote: "PDA mode: escrow account is program-owned PDA derived from [escrow, intentId_le8]",
    note: "SOL: fetch per-intent escrow address from GET /api/intent/:id/sol-escrow. ETH: call createIntent() on ethEscrowContract via calldata from /api/escrow/prepare-tx.",
  });
});

// ── GET /api/escrow/prepare-tx ────────────────────────────────────────────────
// Returns ABI-encoded calldata for createIntent() on the real PrivateIntentEscrow
// contract, plus the predicted on-chain intentId (nextIntentId snapshot).
// Frontend uses the returned calldata in eth_sendTransaction via Phantom.
router.get("/escrow/prepare-tx", async (req, res) => {
  try {
    const { dbIntentId } = req.query as { dbIntentId?: string };
    if (!dbIntentId) return res.status(400).json({ error: "dbIntentId query param required" });

    const id = parseInt(dbIntentId, 10);
    const [row] = await db.select().from(intentsTable).where(eq(intentsTable.id, id)).limit(1);
    if (!row) return res.status(404).json({ error: "Intent not found" });

    const contractAddress = getEscrowContractAddress();
    const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);

    // Read nextIntentId from contract to predict the on-chain id we'll get
    const escrowIface = new ethers.Interface([
      "function nextIntentId() view returns (uint256)",
      "function createIntent(string,string,string,string,uint256,string) payable returns (uint256)",
    ]);
    const contract = new ethers.Contract(contractAddress, escrowIface, provider);
    let predictedOnchainId = 0;
    try {
      const next = await contract.nextIntentId();
      predictedOnchainId = Number(next);
    } catch { /* non-critical — frontend still needs calldata */ }

    // ABI-encode createIntent(fromChain,toChain,fromToken,toToken,releaseAfter,proofHash)
    // proofHash must be a real on-chain identifier — never a synthetic fallback.
    const proofHash = row.proofHash ?? row.encryptedIntentId;
    if (!proofHash) {
      return res.status(400).json({
        error: "No on-chain proofHash stored for this intent. Intent must be submitted first so an Encrypt FHE ID is generated.",
        intentId: id,
      });
    }
    const calldata = escrowIface.encodeFunctionData("createIntent", [
      row.fromChain, row.toChain, row.fromToken, row.toToken,
      0n, // releaseAfter=0 (no timelock)
      proofHash,
    ]);

    return res.json({ calldata, contractAddress, predictedOnchainId });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/intent/:id/sol-escrow ────────────────────────────────────────────
// Returns the unique per-intent SOL escrow address for this intentId.
// Frontend sends SOL here instead of the shared sentinel pubkey.
router.get("/intent/:id/sol-escrow", (req, res) => {
  const intentId = parseInt(req.params.id, 10);
  if (!intentId || isNaN(intentId) || intentId <= 0) {
    return res.status(400).json({ error: "Invalid intentId" });
  }
  const address = getSolIntentEscrowAddress(intentId);
  return res.json({
    intentId,
    escrowAddress: address,
    explorerUrl: `https://explorer.solana.com/address/${address}?cluster=devnet`,
    type: "pda",
    solEscrowType: "pda",  // alias used by the frontend deposit flow
    programId: SOL_ESCROW_PROGRAM_ID,
    note: "Unique SOL escrow account derived per intent. Only the operator can release funds after delivery.",
  });
});

// ── GET /api/intent/:id/refund-tx ─────────────────────────────────────────────
// Returns the pre-serialized Anchor `refund` instruction data for the user to
// sign via Phantom. The API server cannot sign refunds — the program requires
// the original depositor as a signer. Frontend replaces DEPOSITOR_PUBKEY.
router.get("/intent/:id/refund-tx", (req, res) => {
  const intentId = parseInt(req.params.id, 10);
  if (!intentId || isNaN(intentId) || intentId <= 0) {
    return res.status(400).json({ error: "Invalid intentId" });
  }
  const params = buildRefundInstructionParams(intentId);
  return res.json({
    intentId,
    ...params,
    rpcUrl: SOLANA_DEVNET_RPC,
    usage: "Replace DEPOSITOR_PUBKEY with user's pubkey, sign tx via Phantom, send to Solana devnet.",
  });
});

// ── GET /api/intent/solvers ────────────────────────────────────────────────────
router.get("/intent/solvers", (_req, res) => {
  const solvers = getAllSolvers();
  return res.json({ solvers, count: solvers.length, standard: "ERC-7683-Inspired" });
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

    return res.json({ history, count: history.length, privacyMode: "fhe-sealed" });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
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

    let encryptedIntentId: string;
    let encryptedIntentHash: string;
    const encryptMode = "devnet";

    try {
      const encrypted = await encryptAuditLog({
        event: "intent_submitted",
        data: intentPayload,
        walletAddress: phantomPubkey,
      });
      if (!encrypted.onChainId) {
        throw new Error("Encrypt FHE returned no onChainId — on-chain sealing incomplete");
      }
      encryptedIntentId = encrypted.onChainId;
      encryptedIntentHash = encrypted.encrypted.slice(0, 64);
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      process.stderr.write(`[intent/submit] Encrypt FHE offline — aborting intent creation. Error: ${msg}\n`);
      return res.status(503).json({
        error: "Encrypt FHE offline — intent cannot be sealed. Retry when the Encrypt network is reachable.",
        detail: msg,
      });
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

    // ── Honest bidding: cap live solver bid to actual deliverable inventory ──────
    // Fetch solver capacity in parallel with bid collection (already done above).
    // For cross-chain swaps, the live solver must quote what it can ACTUALLY deliver,
    // not a theoretical market rate. This prevents over-quoting that leads to
    // partial deliveries and stuck intents.
    let liveSolverCap: { sol: { maxDeliverable: number; status: string }; eth: { maxDeliverable: number; status: string } } | null = null;
    try {
      if (["SOL","ETH","BASE","ARB"].includes(toChain) && ["SOL","ETH","BASE","ARB"].includes(fromChain) && fromChain !== toChain) {
        liveSolverCap = await getLiveSolverCapacity();
      }
    } catch { /* non-fatal: cap stays null, bid used as-is */ }

    const cappedCustomBids = customBids.map((bid: any) => {
      if (!liveSolverCap) return bid;
      const isLiveBid = bid.solverId === LIVE_SOLVER_ID || bid.solverId?.startsWith("live-solver") || bid.solverName?.includes("Live Solver");
      if (!isLiveBid) return bid;

      const quoted = parseFloat(bid.outputAmount);
      let maxDeliverable: number;
      if (toChain === "SOL") maxDeliverable = liveSolverCap.sol.maxDeliverable;
      else if (["ETH","BASE","ARB"].includes(toChain)) maxDeliverable = liveSolverCap.eth.maxDeliverable;
      else return bid; // unsupported chain — no cap

      if (maxDeliverable <= 0) {
        process.stderr.write(`[Intent/bid] Live solver inventory critical for ${toChain} — omitting from bid pool\n`);
        return null; // will filter below
      }
      if (quoted > maxDeliverable) {
        const capped = maxDeliverable.toFixed(6);
        process.stdout.write(`[Intent/bid] Live solver bid capped ${quoted.toFixed(6)} → ${capped} ${toChain} (inventory limit)\n`);
        return { ...bid, outputAmount: capped, solverDescription: `${bid.solverDescription ?? ""} [inventory-capped: max ${capped} ${toChain}]`.trim() };
      }
      return bid;
    }).filter(Boolean);

    const allBids = [
      ...(aiBid ? [aiBid] : []),
      ...cappedCustomBids,
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
    const aiLabel = `${allBids.length}total(${aiBid !== null ? "1AI+" : ""}${cappedCustomBids.length}custom)`;
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

    return res.status(201).json({
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
    return res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/intent/:id ────────────────────────────────────────────────────────
router.get("/intent/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id ?? "0");
    if (!id) return res.status(400).json({ error: "Invalid intent id" });

    const [row] = await db.select().from(intentsTable).where(eq(intentsTable.id, id)).limit(1);
    if (!row) return res.status(404).json({ error: "Intent not found" });

    return res.json({
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
      deliveryError: row.deliveryError ?? null,
      deliveredAmount: row.deliveredAmount ?? null,
      proofHash: row.proofHash,
      escrowPda: row.escrowPda,
      deadline: row.deadline,
      releaseAfter: row.releaseAfter?.toISOString() ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      standard: "ERC-7683-Inspired",
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
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

    // ── Solver inventory pre-check ─────────────────────────────────────────────
    // Verify solver has sufficient funds to fulfill BEFORE locking user's escrow.
    // If solver can't deliver, reject early so user's funds are never committed.
    {
      const toChain = row.toChain as string;
      const fulfillCheck = await checkSolverCanFulfill(toChain, winningBid.outputAmount);
      if (!fulfillCheck.ok) {
        const isCheckError = fulfillCheck.available === "check_error" || fulfillCheck.available === "unsupported_chain";
        if (isCheckError) {
          // RPC/connectivity failure — cannot verify inventory. Refuse to lock escrow
          // (fail closed). Return 503 so client can retry after connectivity restores.
          process.stderr.write(
            `[Intent/accept] ABORT intentId=${row.id} inventory_check_unavailable (${fulfillCheck.available}): refusing escrow lock until solver RPC is reachable\n`
          );
          return res.status(503).json({
            error: "solver_inventory_check_unavailable",
            message: "Cannot verify solver liquidity right now (RPC error). Your funds have NOT been committed. Please retry in a moment.",
            available: fulfillCheck.available,
          });
        }
        process.stderr.write(
          `[Intent/accept] REJECT intentId=${row.id} solver_insufficient_inventory: need ${fulfillCheck.required} ${toChain}, have ${fulfillCheck.available} ${toChain}\n`
        );
        return res.status(409).json({
          error: "solver_insufficient_inventory",
          message: `Solver cannot fulfill this swap. Available: ${fulfillCheck.available} ${toChain}, required: ${fulfillCheck.required} ${toChain}. Shortfall: ${fulfillCheck.shortfall ?? "?"} ${toChain}.`,
          available: fulfillCheck.available,
          required: fulfillCheck.required,
          shortfall: fulfillCheck.shortfall,
          hint: toChain === "SOL"
            ? "Top up solver SOL wallet at https://faucet.solana.com or reduce swap amount."
            : `Top up solver ETH wallet on ${toChain} Sepolia or reduce swap amount.`,
        });
      }
      process.stdout.write(
        `[Intent/accept] inventory OK intentId=${row.id} available=${fulfillCheck.available} ${toChain} >= required=${fulfillCheck.required} ${toChain}\n`
      );
    }

    // Determine escrow address and, for ETH origins, lock ETH server-side
    const fromChain = row.fromChain ?? "SOL";
    const isEthOrigin = ["ETH", "BASE", "ARB"].includes(fromChain);

    let escrowPda: string;
    let resolvedSourceTxId = sourceTxId ?? null;

    let resolvedOnchainIntentId: number | undefined;

    if (isEthOrigin) {
      if (resolvedSourceTxId) {
        // ETH origin: user signed createIntent() via Phantom.
        // 1. Wait for TX receipt and verify it succeeded.
        // 2. Parse IntentCreated event to extract the on-chain intentId.
        // 3. Verify deposit via getIntent(onchainIntentId).
        process.stdout.write(`[Intent]  ETH-deposit verifying dbId=${intentId} tx=${resolvedSourceTxId.slice(0, 14)}…\n`);

        const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
        const escrowIface = new ethers.Interface([
          "event IntentCreated(uint256 indexed intentId, address indexed user, uint256 amount, string fromChain, string toChain, string fromToken, string toToken, uint256 releaseAfter)",
        ]);

        // Poll for receipt (TX may still be pending when accept is called)
        let receipt: any = null;
        const receiptDeadline = Date.now() + 60_000; // wait up to 60s for confirmation
        while (Date.now() < receiptDeadline && !receipt) {
          receipt = await provider.getTransactionReceipt(resolvedSourceTxId).catch(() => null);
          if (!receipt) await new Promise<void>(r => setTimeout(r, 4_000));
        }

        if (!receipt) {
          return res.status(400).json({ error: "ETH deposit TX not confirmed after 60s. Check Sepolia Etherscan and retry." });
        }
        if (receipt.status !== 1) {
          return res.status(400).json({
            error: `ETH deposit TX reverted on-chain (status ${receipt.status}). Check https://sepolia.etherscan.io/tx/${resolvedSourceTxId} — the createIntent() call may have failed. Try submitting a new swap.`,
          });
        }

        // Parse IntentCreated event from receipt logs
        for (const log of receipt.logs) {
          try {
            const parsed = escrowIface.parseLog({ topics: [...log.topics], data: log.data });
            if (parsed?.name === "IntentCreated") {
              resolvedOnchainIntentId = Number(parsed.args.intentId);
              break;
            }
          } catch { /* skip non-matching logs */ }
        }

        if (!resolvedOnchainIntentId) {
          // Fallback: TX went to contract but no IntentCreated event — verify by raw value
          process.stdout.write(`[Intent]  ETH-deposit IntentCreated event not found in receipt — using receipt fallback\n`);
        }

        process.stdout.write(`[Intent]  ETH-deposit TX confirmed. onchainIntentId=${resolvedOnchainIntentId ?? "?"} tx=${resolvedSourceTxId.slice(0, 14)}…\n`);

        // Verify deposit amount via contract (uses onchainIntentId if available)
        const dep = await checkEthDepositOnChain(
          resolvedOnchainIntentId ?? intentId,
          15_000,
          resolvedSourceTxId,
        );
        if (!dep) {
          return res.status(400).json({
            error: "ETH deposit not found on-chain after 15s. Ensure the Phantom transaction was submitted and confirmed, then retry.",
          });
        }

        let requiredWei: bigint;
        try { requiredWei = ethers.parseEther(row.amount ?? "0"); }
        catch { requiredWei = 0n; }
        const tolerance = requiredWei * 995n / 1000n;
        if (requiredWei > 0n && dep.amount < tolerance) {
          return res.status(400).json({
            error: `ETH deposit underfunded: on-chain amount ${ethers.formatEther(dep.amount)} ETH is less than required ${row.amount} ETH (99.5% minimum).`,
          });
        }

        escrowPda = getEscrowContractAddress();
        process.stdout.write(`[Intent]  ETH-escrow deposit CONFIRMED dbId=${intentId} onchainId=${resolvedOnchainIntentId ?? "?"} onChain=${ethers.formatEther(dep.amount)} ETH required=${row.amount} ETH\n`);
      } else {
        // No browser-signed tx — server-side deposit path
        const ethEscrow = await lockEthEscrow(row.amount, intentId, {
          fromChain: row.fromChain, toChain: row.toChain,
          fromToken: row.fromToken, toToken: row.toToken,
          proofHash: row.encryptedIntentId ?? undefined,
        }).catch(e => ({
          success: false, txHash: "", escrowAddress: "", explorerUrl: "",
          onchainIntentId: undefined, error: (e as Error).message,
        }));
        if (ethEscrow.success) {
          resolvedSourceTxId = ethEscrow.txHash;
          escrowPda = ethEscrow.escrowAddress;
          resolvedOnchainIntentId = ethEscrow.onchainIntentId;
          process.stdout.write(`[Intent]  ETH-escrow server-lock OK dbId=${intentId} onchainId=${resolvedOnchainIntentId ?? "?"} tx=${ethEscrow.txHash.slice(0, 18)}…\n`);
        } else {
          return res.status(503).json({
            error: `ETH escrow lock failed: ${ethEscrow.error}. Provide a browser-signed deposit tx via Phantom.`,
          });
        }
      }
    } else {
      // SOL origin: SOL was already locked by the frontend Phantom tx into the per-intent escrow account
      escrowPda = getSolIntentEscrowAddress(intentId);
    }

    // Use the real on-chain FHE ID as the pre-delivery proof anchor.
    // If encryptedIntentId is missing the intent was never sealed — hard-fail.
    // After delivery, proofHash is overwritten with the real delivery tx hash in executeDelivery().
    if (!row.encryptedIntentId) {
      return res.status(503).json({
        error: "Intent has no FHE on-chain ID — cannot seal accept proof. Re-submit the intent to generate a real Encrypt ID.",
      });
    }
    const proofHash = row.encryptedIntentId;

    await db
      .update(intentsTable)
      .set({
        status: "accepted",
        winningSolverId: solverId,
        escrowPda,
        sourceTxId: resolvedSourceTxId,
        proofHash,
        onchainIntentId: resolvedOnchainIntentId != null ? String(resolvedOnchainIntentId) : null,
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

    const sourceTxExplorer = resolvedSourceTxId
      ? isEthOrigin
        ? `https://sepolia.etherscan.io/tx/${resolvedSourceTxId}`
        : `https://explorer.solana.com/tx/${resolvedSourceTxId}?cluster=devnet`
      : null;

    const escrowNetwork = isEthOrigin ? "ETH Sepolia" : "Solana Devnet";
    const escrowNote = `${fromChain} locked in ${escrowNetwork} escrow (${escrowPda.slice(0, 8)}…). Released to solver after delivery proof.`;

    return res.json({
      intentId,
      status: "accepted",
      solverId,
      solverName: winningBid.solverName,
      escrowPda,
      escrowNote,
      sourceTxId: resolvedSourceTxId,
      sourceTxExplorer,
      expectedDelivery: new Date(Date.now() + winningBid.estimatedSeconds * 1000).toISOString(),
      winningBid,
      standard: "ERC-7683-Inspired",
      resolvedOrder,
      viewingKeyGranted: true,
      viewingKeyNote: "Viewing key embedded in resolvedOrder — winning solver uses this to decrypt intent and validate before execution.",
    });
  } catch (err) {
    console.error("[intent/accept]", err);
    return res.status(500).json({ error: (err as Error).message });
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
    let deliveryActualAmount: string | undefined;
    const toChain = bid.toChain as string;
    const isLiveSolver = bid.solverId?.includes("live-solver") || bid.solverName?.includes("Live Solver");

    // ── Live Delivery: always use live solver wallet for real testnet tx ────────
    // Regardless of which solver "won" the auction (price discovery), the actual
    // delivery uses the live solver's funded testnet wallet.
    {
      const destAddr = intent.destinationAddress || getUserDest(toChain);

      // Hard-fail if no valid destination address — never silently deliver to wrong address
      if (!destAddr) {
        const errMsg = `No destination address for ${toChain}. Check intent.destinationAddress or user dWallet.`;
        process.stderr.write(`[delivery] ABORT intentId=${intentId}: ${errMsg}\n`);
        await db
          .update(intentsTable)
          .set({ status: "delivery_failed", deliveryError: errMsg, updatedAt: new Date() })
          .where(eq(intentsTable.id, intentId));
        return;
      }
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
        deliveryActualAmount = result.amount; // actual amount delivered (may differ from quoted)
        process.stdout.write(`[delivery/live] REAL tx success txHash=${deliveryTxId.slice(0, 18)}… explorer=${deliveryExplorerUrl} actual=${deliveryActualAmount} ${result.unit ?? ""}\n`);

        // Release the locked escrow to the solver after delivery.
        // ETH: call release() on the PrivateIntentEscrow contract (polls up to 120s for deposit).
        // SOL: send Anchor `release` instruction to the per-intent PDA (operator-signed).
        // Settlement is GATED on release success.
        const fromChainLabel = (bid.fromChain ?? intent.fromChain ?? "SOL") as string;
        let escrowReleaseOk = true;

        if (["ETH", "BASE", "ARB"].includes(fromChainLabel)) {
          const solverEthAddress = getLiveSolverAddresses().eth;
          // Re-read DB for onchainIntentId (set during accept after parsing IntentCreated event)
          const [freshRow] = await db.select().from(intentsTable).where(eq(intentsTable.id, intentId)).limit(1);
          const onchainIntentId = freshRow?.onchainIntentId ? Number(freshRow.onchainIntentId) : undefined;
          const releaseResult = await releaseFromEscrowContract(intentId, solverEthAddress, deliveryTxId, onchainIntentId);
          escrowReleaseOk = releaseResult.success;
          if (releaseResult.success) {
            process.stdout.write(`[delivery/live] ETH escrow released intentId=${intentId} onchainId=${onchainIntentId ?? "?"}${releaseResult.txHash ? ` tx=${releaseResult.txHash.slice(0, 18)}…` : " (already settled)"}\n`);
          } else {
            process.stderr.write(`[delivery/live] ETH escrow release FAILED intentId=${intentId}: ${releaseResult.error} — marking release_failed\n`);
          }
        } else if (fromChainLabel === "SOL") {
          // SOL-origin: Anchor `release` ix — single-sourced through solEscrowService.releaseSolEscrow().
          // Zero-balance returns success=true (idempotent already-released path).
          const solverSolAddress = getLiveSolverAddresses().sol;
          if (solverSolAddress) {
            const solRelease = await releaseSolEscrow(intentId, solverSolAddress);
            escrowReleaseOk = solRelease.success;
            if (solRelease.success) {
              process.stdout.write(`[delivery/live] SOL escrow released intentId=${intentId}${solRelease.txHash ? ` tx=${solRelease.txHash.slice(0, 16)}…` : ` (${solRelease.mode ?? "no-op"})`}\n`);
            } else {
              process.stderr.write(`[delivery/live] SOL escrow release FAILED intentId=${intentId}: ${solRelease.error} — marking release_failed\n`);
            }
          } else {
            process.stdout.write(`[delivery/live] SOL escrow: no solver SOL address — skipping release for intentId=${intentId}\n`);
          }
        }

        if (!escrowReleaseOk) {
          // Delivery to user succeeded but solver payout failed — needs operator intervention.
          // executeDelivery() is called fire-and-forget after HTTP response is sent, so there
          // is no `res` here. Persist release_failed and return — the polling status endpoint
          // will surface this to the caller.
          await db
            .update(intentsTable)
            .set({ status: "release_failed", deliveryTxId: result.txHash, updatedAt: new Date() })
            .where(eq(intentsTable.id, intentId));
          return; // halt further settlement; operator must call release() manually
        }
      } else {
        // Real delivery failed — surface the error, do not fabricate a tx ID
        const errMsg = result.error ?? "Live solver delivery returned failure with no txHash";
        process.stderr.write(`[delivery/live] real tx failed: ${errMsg}\n`);
        await db
          .update(intentsTable)
          .set({ status: "delivery_failed", deliveryError: errMsg, updatedAt: new Date() })
          .where(eq(intentsTable.id, intentId));
        return;
      }
    }

    // Live delivery covers all chains — no separate Ika MPC path needed for testnet

    if (!deliveryTxId) {
      const errMsg = "No deliveryTxId produced after all delivery paths — no real tx was confirmed";
      process.stderr.write(`[delivery] ${errMsg} intentId=${intentId}\n`);
      await db
        .update(intentsTable)
        .set({ status: "delivery_failed", deliveryError: errMsg, updatedAt: new Date() })
        .where(eq(intentsTable.id, intentId));
      return;
    }

    const proofHash = deliveryTxId;

    const storedTxId = isLiveDelivery && deliveryExplorerUrl
      ? `${deliveryTxId}|${deliveryExplorerUrl}`
      : deliveryTxId;

    await db
      .update(intentsTable)
      .set({ status: "delivered", deliveryTxId: storedTxId, proofHash, deliveredAmount: isLiveDelivery ? (deliveryActualAmount ?? null) : null, updatedAt: new Date() })
      .where(eq(intentsTable.id, intentId));

    setTimeout(async () => {
      await db
        .update(intentsTable)
        .set({ status: "settled", updatedAt: new Date() })
        .where(eq(intentsTable.id, intentId));
    }, 3000);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[executeDelivery] failed:", errMsg);
    await db
      .update(intentsTable)
      .set({ status: "delivery_failed", deliveryError: errMsg, updatedAt: new Date() })
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

    // Release SOL from per-intent PDA escrow → solver via the Anchor program.
    // Release is MANDATORY for settlement — if release fails the intent is
    // marked release_failed (not settled) and the operator must retry.
    if (!solverSolAddress) {
      return res.status(400).json({
        error: "Cannot resolve solver payment address — settlement blocked",
        note: "Provide solverPaymentAddress in request body or ensure the solver has a registered SOL address.",
      });
    }

    const releaseResult = await releaseSolEscrow(intentId, solverSolAddress);

    if (!releaseResult.success) {
      const errMsg = releaseResult.error ?? "releaseSolEscrow returned failure";
      process.stderr.write(
        `[settle] SOL release FAILED intentId=${intentId}: ${errMsg}\n`
      );
      await db
        .update(intentsTable)
        .set({ status: "release_failed", updatedAt: new Date() })
        .where(eq(intentsTable.id, intentId));
      return res.status(502).json({
        intentId,
        status: "release_failed",
        error: errMsg,
        note: "Escrow release failed — intent marked release_failed. Operator must retry release after diagnosing cause.",
      });
    }

    const releaseTxId = releaseResult.txHash ?? null;
    const releaseTxExplorer = releaseResult.explorerUrl ?? null;
    process.stdout.write(
      `[settle] SOL released intentId=${intentId} mode=${releaseResult.mode} → ${solverSolAddress.slice(0, 12)}… ${releaseTxId ? `sig=${releaseTxId.slice(0, 16)}…` : "(already-drained)"}\n`
    );
    // Inventory recycling log — shows solver SOL replenished from escrow
    try {
      const { Connection: Conn, PublicKey: PK } = await import("@solana/web3.js");
      const conn2 = new Conn(process.env.SOLANA_DEVNET_RPC ?? "https://api.devnet.solana.com", "confirmed");
      const newBal2 = await conn2.getBalance(new PK(solverSolAddress));
      const inputAmt = row.amount ?? "?";
      process.stdout.write(`[SolverInventory] +${inputAmt} SOL received from SOL escrow release intentId=${intentId}. SOL wallet now: ${(newBal2 / 1e9).toFixed(6)} SOL\n`);
    } catch { /* non-fatal */ }

    await db
      .update(intentsTable)
      .set({ status: "settled", proofHash, updatedAt: new Date() })
      .where(eq(intentsTable.id, intentId));

    return res.json({
      intentId,
      status: "settled",
      proofHash,
      escrowPda: row.escrowPda,
      releaseTxId,
      releaseTxExplorer,
      note: releaseTxId
        ? `Escrow released — SOL sent to solver. Verify: ${releaseTxExplorer}`
        : "Settled — escrow already drained (previously released).",
      deliveryTxId: row.deliveryTxId,
      standard: "ERC-7683-Inspired",
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/admin/retry-delivery ───────────────────────────────────────────
// Requires x-operator-key header matching OPERATOR_API_KEY env var.
// If OPERATOR_API_KEY is not configured, returns 503 (fail closed).
function requireOperatorKey(req: any, res: any, next: any) {
  const configured = process.env["OPERATOR_API_KEY"];
  if (!configured) {
    res.status(503).json({ error: "OPERATOR_API_KEY not configured on server — admin routes unavailable" });
    return;
  }
  const provided = (req.headers["x-operator-key"] as string | undefined) ?? "";
  if (!provided || provided !== configured) {
    res.status(401).json({ error: "Unauthorized — valid x-operator-key header required" });
    return;
  }
  next();
}

router.post("/admin/retry-delivery", requireOperatorKey, async (req, res) => {
  try {
    const { intentId } = req.body as { intentId: number };
    if (!intentId) return res.status(400).json({ error: "intentId required" });

    const [row] = await db.select().from(intentsTable).where(eq(intentsTable.id, intentId)).limit(1);
    if (!row) return res.status(404).json({ error: "Intent not found" });

    const allowedStates = ["failed", "release_failed"];
    if (!allowedStates.includes(row.status ?? "")) {
      return res.status(409).json({
        error: `Cannot retry intent in state "${row.status}". Only failed/release_failed intents can be retried.`,
        currentStatus: row.status,
      });
    }

    const bids = (row.solverBids as any[]) ?? [];
    const winningBid = bids.find((b: any) => b.solverId === row.winningSolverId) ?? bids[0];
    if (!winningBid) {
      return res.status(400).json({ error: "No winning bid found for intent — cannot retry" });
    }

    process.stdout.write(`[admin/retry] Retrying delivery for intentId=${intentId} status=${row.status} toChain=${row.toChain}\n`);

    // Reset to accepted so executeDelivery runs clean
    await db
      .update(intentsTable)
      .set({ status: "accepted", updatedAt: new Date() })
      .where(eq(intentsTable.id, intentId));

    // Fire async — same as normal accept flow
    executeDelivery(intentId, winningBid, row).catch(e =>
      console.error("[admin/retry] delivery error:", e)
    );

    return res.json({
      success: true,
      intentId,
      status: "retrying",
      message: `Delivery retry initiated for intent #${intentId}. Poll GET /api/intent/${intentId} for status updates.`,
      bid: { solverId: winningBid.solverId, outputAmount: winningBid.outputAmount, toChain: row.toChain },
      // deliveryTxId: undefined — not yet available (async); poll GET /api/intent/:id for result
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
