/**
 * Private Intent — AI Routes
 *
 * POST /api/intent/parse    — Natural language → structured intent (chain abstraction)
 * POST /api/intent/optimize — AI route optimization analysis
 * POST /api/intent/dispute  — AI dispute resolution judge
 * GET  /api/solver/ai-status — AI solver agent status
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { intentsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  parseIntentFromNL,
  optimizeRoute,
  evaluateDispute,
} from "../services/aiAgent.js";
import { aiSolverAgent } from "../services/aiSolverAgent.js";
import {
  registerSolver,
  deregisterSolver,
  getAllCustomSolvers,
  getCustomSolver,
} from "../services/customSolverRegistry.js";

// We need direct db access for solver/bid endpoint (already imported above)
import {
  getLiveSolverBalances,
  getLiveSolverAddresses,
  requestSolAirdrop,
} from "../services/liveSolverService.js";

const router = Router();

// ── POST /api/intent/parse ────────────────────────────────────────────────────
// Chain Abstraction: user types anything, AI extracts intent params
router.post("/intent/parse", async (req, res) => {
  try {
    const { text } = req.body as { text: string };
    if (!text || text.trim().length < 3) {
      return res.status(400).json({ error: "text required (min 3 chars)" });
    }
    const result = await parseIntentFromNL(text.trim());
    res.json({ parsed: result, source: "claude-sonnet-4-6" });
  } catch (err) {
    console.error("[ai/parse]", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/intent/optimize ─────────────────────────────────────────────────
// AI route optimization: given params + current bids, recommend best route
router.post("/intent/optimize", async (req, res) => {
  try {
    const { fromChain, toChain, amount, bids = [] } = req.body as {
      fromChain: string;
      toChain: string;
      amount: string;
      bids?: any[];
    };
    if (!fromChain || !toChain || !amount) {
      return res.status(400).json({ error: "fromChain, toChain, amount required" });
    }
    const result = await optimizeRoute({ fromChain, toChain, amount, currentBids: bids });
    res.json({ optimization: result, source: "claude-sonnet-4-6" });
  } catch (err) {
    console.error("[ai/optimize]", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/intent/dispute ──────────────────────────────────────────────────
// AI dispute judge: user claims delivery not received, AI evaluates
router.post("/intent/dispute", async (req, res) => {
  try {
    const { intentId, userClaim } = req.body as { intentId: number; userClaim: string };
    if (!intentId || !userClaim) {
      return res.status(400).json({ error: "intentId and userClaim required" });
    }

    const [row] = await db.select().from(intentsTable).where(eq(intentsTable.id, intentId)).limit(1);
    if (!row) return res.status(404).json({ error: "Intent not found" });

    const bids = (row.solverBids as any[]) ?? [];
    const winningBid = bids.find((b: any) => b.solverId === row.winningSolverId);

    const verdict = await evaluateDispute({
      intentId: row.id,
      fromChain: row.fromChain,
      toChain: row.toChain,
      amount: row.amount,
      deliveryTxId: row.deliveryTxId ?? "",
      proofHash: row.proofHash ?? "",
      solverName: winningBid?.solverName ?? "Unknown Solver",
      userClaim,
      status: row.status,
    });

    // Auto-update status based on verdict
    if (verdict.verdict === "refund" && verdict.confidence > 0.85) {
      await db.update(intentsTable)
        .set({ status: "refunded", updatedAt: new Date() })
        .where(eq(intentsTable.id, intentId));
    }

    res.json({
      intentId,
      verdict,
      currentStatus: row.status,
      source: "claude-sonnet-4-6",
      note: "AI verdict is advisory. High-confidence verdicts (>85%) trigger automatic status updates.",
    });
  } catch (err) {
    console.error("[ai/dispute]", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/solver/ai-status ─────────────────────────────────────────────────
router.get("/solver/ai-status", (_req, res) => {
  const status = aiSolverAgent.getStatus();
  res.json(status);
});

// ── POST /api/solver/register ─────────────────────────────────────────────────
// Permissionless solver registration — anyone can join the marketplace
router.post("/solver/register", (req, res) => {
  try {
    const {
      name, description, operatorAddress,
      baseFeePercent, supportedFromChains, supportedToChains,
      webhookUrl, strategy,
    } = req.body as {
      name: string;
      description?: string;
      operatorAddress: string;
      baseFeePercent: number;
      supportedFromChains: string[];
      supportedToChains: string[];
      webhookUrl?: string;
      strategy?: string;
    };

    if (!name || !operatorAddress || baseFeePercent == null) {
      return res.status(400).json({ error: "name, operatorAddress, and baseFeePercent are required" });
    }
    if (!Array.isArray(supportedFromChains) || supportedFromChains.length === 0) {
      return res.status(400).json({ error: "supportedFromChains must be a non-empty array" });
    }
    if (!Array.isArray(supportedToChains) || supportedToChains.length === 0) {
      return res.status(400).json({ error: "supportedToChains must be a non-empty array" });
    }

    const solver = registerSolver({
      name, description: description ?? "", operatorAddress,
      baseFeePercent, supportedFromChains, supportedToChains,
      webhookUrl, strategy,
    });

    res.status(201).json({
      success: true,
      solver,
      message: `Solver "${solver.name}" registered. It will now participate in all matching intent bids automatically.`,
      nextSteps: [
        "Your solver will auto-bid on intents matching your supported routes",
        "POST /api/solver/bid/:intentId to submit a custom bid for a specific intent",
        "GET /api/solver/list to see all solvers in the marketplace",
        `DELETE /api/solver/${solver.id} to deregister`,
      ],
    });
  } catch (err) {
    console.error("[solver/register]", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/solver/bid/:intentId ───────────────────────────────────────────
// External solver submits a live bid for an open intent (ERC-7683 open fill model)
// Body: { solverId, outputAmount, feePercent, estimatedSeconds }
// The solverId must match a registered custom solver.
router.post("/solver/bid/:intentId", async (req, res) => {
  try {
    const intentId = parseInt(req.params.intentId ?? "0");
    if (!intentId) return res.status(400).json({ error: "Invalid intentId" });

    const { solverId, outputAmount, feePercent, estimatedSeconds } = req.body as {
      solverId: string;
      outputAmount: string;
      feePercent: number;
      estimatedSeconds?: number;
    };

    if (!solverId || !outputAmount || feePercent == null) {
      return res.status(400).json({ error: "solverId, outputAmount, and feePercent required" });
    }

    const solver = getCustomSolver(solverId);
    if (!solver) {
      return res.status(404).json({ error: `Solver "${solverId}" not found. Register first at POST /api/solver/register` });
    }

    const [row] = await db.select().from(intentsTable).where(eq(intentsTable.id, intentId)).limit(1);
    if (!row) return res.status(404).json({ error: "Intent not found" });

    if (row.status !== "bidding") {
      return res.status(409).json({ error: `Intent is ${row.status} — only open intents accept new bids`, status: row.status });
    }

    if (row.deadline && new Date() > row.deadline) {
      return res.status(410).json({ error: "Intent bid window has expired" });
    }

    // Build new bid
    const newBid = {
      solverId: solver.id,
      solverName: solver.name,
      solverDescription: solver.description,
      solverStrategy: "custom" as const,
      fromChain: row.fromChain,
      toChain: row.toChain,
      fromToken: row.fromToken,
      toToken: row.toToken,
      inputAmount: row.amount,
      outputAmount: String(outputAmount),
      feePercent: Number(feePercent),
      feeAmount: (parseFloat(row.amount) * (Number(feePercent) / 100)).toFixed(6),
      estimatedSeconds: estimatedSeconds ?? 60,
      expiresAt: Date.now() + 120_000,
      reputationScore: Math.floor(70 + Math.random() * 25),
      isCustomSolver: true,
      operatorAddress: solver.operatorAddress,
      erc7683Compliant: true,
      chainDetails: {
        network: row.toChain === "BTC" ? "Bitcoin Testnet3" : row.toChain === "SOL" ? "Solana Devnet" : `${row.toChain} Sepolia`,
        explorerUrl: row.toChain === "BTC" ? "https://mempool.space/testnet" : row.toChain === "SOL" ? "https://explorer.solana.com/?cluster=devnet" : "https://sepolia.etherscan.io",
        nativeSign: row.toChain === "SOL" ? "Ika Curve25519 EddsaSha512" : "Ika Secp256k1 EcdsaKeccak256",
      },
      submittedVia: "POST /api/solver/bid/:intentId",
      submittedAt: new Date().toISOString(),
    };

    // Remove any existing bid from same solver, add new one
    const existingBids = ((row.solverBids as any[]) ?? []).filter((b: any) => b.solverId !== solverId);
    const updatedBids = [...existingBids, newBid].sort((a: any, b: any) =>
      parseFloat(b.outputAmount) - parseFloat(a.outputAmount)
    );

    await db
      .update(intentsTable)
      .set({ solverBids: updatedBids as any, updatedAt: new Date() })
      .where(eq(intentsTable.id, intentId));

    solver.totalBids++;

    res.status(201).json({
      success: true,
      intentId,
      bid: newBid,
      totalBids: updatedBids.length,
      rank: updatedBids.findIndex((b: any) => b.solverId === solverId) + 1,
      message: `Bid submitted for intent #${intentId}. You are ranked #${updatedBids.findIndex((b: any) => b.solverId === solverId) + 1} of ${updatedBids.length} solvers.`,
      standard: "ERC-7683-Inspired",
    });
  } catch (err) {
    console.error("[solver/bid]", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── DELETE /api/solver/:id ────────────────────────────────────────────────────
router.delete("/solver/:id", (req, res) => {
  const { id } = req.params;
  if (!id.startsWith("custom-")) {
    return res.status(403).json({ error: "Cannot deregister built-in solvers" });
  }
  const solver = getCustomSolver(id);
  if (!solver) return res.status(404).json({ error: "Solver not found" });
  deregisterSolver(id);
  res.json({ success: true, message: `Solver "${solver.name}" deregistered` });
});

// ── GET /api/solver/list ──────────────────────────────────────────────────────
// List all solvers in the marketplace (built-in + custom)
router.get("/solver/list", (_req, res) => {
  const builtIn = [
    { id: "solver-alpha", name: "Alpha Solver", type: "built-in", baseFeePercent: 0.30, supportedFromChains: ["SOL", "ETH"], supportedToChains: ["ETH", "SOL"], description: "High-reliability built-in solver" },
    { id: "solver-beta", name: "Beta Solver", type: "built-in", baseFeePercent: 0.25, supportedFromChains: ["SOL", "ETH"], supportedToChains: ["ETH", "SOL"], description: "EVM specialist solver" },
    { id: "solver-gamma", name: "Gamma Solver", type: "built-in", baseFeePercent: 0.50, supportedFromChains: ["SOL", "ETH"], supportedToChains: ["ETH", "SOL"], description: "Wide route coverage solver" },
    { id: "solver-ai", name: "AI Solver (Claude)", type: "ai-agent", baseFeePercent: "dynamic", supportedFromChains: ["SOL", "ETH"], supportedToChains: ["ETH", "SOL"], description: "Autonomous Claude-powered solver with underbid strategy" },
  ];

  const custom = getAllCustomSolvers().map(s => ({ ...s, type: "custom" }));

  res.json({
    total: builtIn.length + custom.length,
    builtIn: builtIn.length,
    custom: custom.length,
    solvers: [...builtIn, ...custom],
    marketplace: {
      openRegistration: true,
      registrationEndpoint: "POST /api/solver/register",
      bidEndpoint: "POST /api/solver/bid/:intentId",
      deregisterEndpoint: "DELETE /api/solver/:id",
    },
  });
});

// ── GET /api/solver/live/status ───────────────────────────────────────────────
// Returns live solver wallet addresses + real testnet balances from RPC
router.get("/solver/live/status", async (_req, res) => {
  try {
    const addresses = getLiveSolverAddresses();
    const balances = await getLiveSolverBalances();
    res.json({
      solverId: "live-solver-private-intent",
      name: "🟢 Live Solver (Private Intent)",
      addresses,
      balances,
      chains: {
        sol: { network: "Solana Devnet", rpc: "https://api.devnet.solana.com", explorer: "https://explorer.solana.com/?cluster=devnet" },
        eth: { network: "Ethereum Sepolia", rpc: "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.etherscan.io" },
        base: { network: "Base Sepolia", rpc: "https://sepolia.base.org", explorer: "https://sepolia.basescan.org" },
        arb: { network: "Arbitrum Sepolia", rpc: "https://sepolia-rollup.arbitrum.io/rpc", explorer: "https://sepolia.arbiscan.io" },
        btc: { network: "Bitcoin Testnet3", rpc: "https://mempool.space/testnet/api", explorer: "https://mempool.space/testnet" },
      },
      faucets: {
        sol: "https://faucet.solana.com",
        eth: "https://sepoliafaucet.com",
        base: "https://docs.base.org/docs/tools/network-faucets",
        arb: "https://faucet.arbitrum.io",
        btc: "https://coinfaucet.eu/en/btc-testnet",
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/solver/live/airdrop ─────────────────────────────────────────────
// Request SOL devnet airdrop for live solver wallet (auto-funded, no real SOL needed)
router.post("/solver/live/airdrop", async (req, res) => {
  try {
    const { chain } = req.body as { chain?: string };
    if (!chain || chain === "SOL") {
      const result = await requestSolAirdrop();
      res.json(result);
    } else {
      res.status(400).json({
        error: `Auto-airdrop only available for SOL devnet. For ${chain}, use the faucet manually.`,
        faucets: {
          ETH: "https://sepoliafaucet.com",
          BASE: "https://docs.base.org/docs/tools/network-faucets",
          ARB: "https://faucet.arbitrum.io",
          BTC: "https://coinfaucet.eu/en/btc-testnet",
        },
      });
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
