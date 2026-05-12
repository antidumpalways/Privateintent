/**
 * Private Intent — Custom Solver Registry
 *
 * Permissionless solver marketplace. Any external party can register as a solver,
 * set their own fee, supported routes, and strategy description.
 *
 * Registered custom solvers automatically participate in the solver race
 * when a matching intent is submitted — their bid is computed from their
 * registered baseFeePercent + optional dynamic adjustment.
 *
 * Architecture (same as NEAR Intents):
 *   Solver registers → Intent submitted → All solvers bid → Best bid wins → Solver delivers
 *
 * In production: solvers would have a webhook/endpoint for real-time bid computation.
 * In demo: bids are computed server-side from registered params.
 */

import { randomBytes } from "crypto";

export interface CustomSolverRegistration {
  id: string;
  name: string;
  description: string;
  operatorAddress: string;
  baseFeePercent: number;
  supportedFromChains: string[];
  supportedToChains: string[];
  webhookUrl?: string;
  strategy: string;
  registeredAt: string;
  totalBids: number;
  wins: number;
}

export interface CustomSolverBid {
  intentId: number;
  solverId: string;
  outputAmount: string;
  feePercent: number;
  estimatedSeconds: number;
  submittedAt: string;
}

const CONVERSION_RATES: Record<string, number> = {
  "SOL-BTC": 0.0015, "SOL-ETH": 0.025, "SOL-BASE": 0.025, "SOL-ARB": 0.025,
  "ETH-SOL": 40.0, "ETH-BTC": 0.06, "BTC-SOL": 650.0, "BTC-ETH": 16.5,
  "SOL-SOL": 1.0, "ETH-ETH": 1.0, "BTC-BTC": 1.0,
};

const CHAIN_TOKENS: Record<string, string> = {
  SOL: "SOL", ETH: "ETH", BTC: "BTC", BASE: "ETH", ARB: "ETH",
};

// In-memory registry (would be DB-backed in production)
const registry = new Map<string, CustomSolverRegistration>();

// Pre-seed two example custom solvers to show the concept
registry.set("custom-delta", {
  id: "custom-delta",
  name: "Delta Solver",
  description: "Community-run solver specializing in SOL↔ETH routes. Low fee, fast settlement.",
  operatorAddress: "DeLTAxyz123456789abcdefghijklmnop",
  baseFeePercent: 0.18,
  supportedFromChains: ["SOL", "ETH"],
  supportedToChains: ["ETH", "SOL"],
  webhookUrl: undefined,
  strategy: "Underbid market by 0.07% on SOL↔ETH routes.",
  registeredAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  totalBids: 127,
  wins: 43,
});

registry.set("custom-epsilon", {
  id: "custom-epsilon",
  name: "Epsilon Solver",
  description: "Institutional solver with deep ETH liquidity. Guaranteed 25s ETH delivery SLA.",
  operatorAddress: "EPSiLoNxyz987654321zyxwvutsrqponm",
  baseFeePercent: 0.35,
  supportedFromChains: ["SOL", "ETH"],
  supportedToChains: ["SOL", "ETH"],
  webhookUrl: undefined,
  strategy: "Price at market + 0.05% spread. Prioritize ETH delivery speed over fee compression.",
  registeredAt: new Date(Date.now() - 86400000 * 7).toISOString(),
  totalBids: 89,
  wins: 31,
});

// ── Public API ─────────────────────────────────────────────────────────────────

export function registerSolver(data: {
  name: string;
  description: string;
  operatorAddress: string;
  baseFeePercent: number;
  supportedFromChains: string[];
  supportedToChains: string[];
  webhookUrl?: string;
  strategy?: string;
}): CustomSolverRegistration {
  const id = `custom-${randomBytes(4).toString("hex")}`;
  const solver: CustomSolverRegistration = {
    id,
    name: data.name,
    description: data.description,
    operatorAddress: data.operatorAddress,
    baseFeePercent: Math.min(2.0, Math.max(0.05, data.baseFeePercent)),
    supportedFromChains: data.supportedFromChains,
    supportedToChains: data.supportedToChains,
    webhookUrl: data.webhookUrl,
    strategy: data.strategy ?? "Competitive market bid",
    registeredAt: new Date().toISOString(),
    totalBids: 0,
    wins: 0,
  };
  registry.set(id, solver);
  return solver;
}

export function deregisterSolver(id: string): boolean {
  return registry.delete(id);
}

export function getAllCustomSolvers(): CustomSolverRegistration[] {
  return Array.from(registry.values());
}

export function getCustomSolver(id: string): CustomSolverRegistration | undefined {
  return registry.get(id);
}

export function recordCustomSolverBid(solverId: string): void {
  const solver = registry.get(solverId);
  if (solver) solver.totalBids++;
}

export function recordCustomSolverWin(solverId: string): void {
  const solver = registry.get(solverId);
  if (solver) solver.wins++;
}

// Compute bids from all registered custom solvers for a given intent
export function getCustomSolverBids(params: {
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  amount: string;
}): any[] {
  const { fromChain, toChain, fromToken, toToken, amount } = params;
  const inputAmt = parseFloat(amount);
  if (isNaN(inputAmt) || inputAmt <= 0) return [];

  const toTokenNorm = toToken || CHAIN_TOKENS[toChain] || toChain;
  const rateKey = `${fromToken}-${toTokenNorm}`;
  const convRate = CONVERSION_RATES[rateKey] ?? 1.0;
  const now = Date.now();

  const bids: any[] = [];

  for (const solver of registry.values()) {
    if (!solver.supportedFromChains.includes(fromChain)) continue;
    if (!solver.supportedToChains.includes(toChain)) continue;

    const jitter = (Math.random() - 0.5) * 0.02 * solver.baseFeePercent;
    const effectiveFee = Math.max(0.05, solver.baseFeePercent + jitter);
    const feeAmt = inputAmt * (effectiveFee / 100);
    const outputAmt = (inputAmt - feeAmt) * convRate;

    const baseTime = toChain === "BTC" ? 70 : toChain === "SOL" ? 18 : 35;
    const estimatedSeconds = baseTime + Math.floor(Math.random() * 20);

    solver.totalBids++;

    bids.push({
      solverId: solver.id,
      solverName: solver.name,
      solverDescription: solver.description,
      solverStrategy: "custom" as const,
      fromChain, toChain, fromToken,
      toToken: toTokenNorm,
      inputAmount: inputAmt.toFixed(6),
      outputAmount: outputAmt.toFixed(6),
      feePercent: parseFloat(effectiveFee.toFixed(3)),
      feeAmount: feeAmt.toFixed(6),
      estimatedSeconds,
      expiresAt: now + 120_000,
      reputationScore: Math.floor(70 + Math.random() * 25),
      isCustomSolver: true,
      operatorAddress: solver.operatorAddress,
      erc7683Compliant: true,
      chainDetails: {
        network: toChain === "BTC" ? "Bitcoin Testnet3" : toChain === "SOL" ? "Solana Devnet" : `${toChain} Sepolia`,
        explorerUrl: toChain === "BTC" ? "https://mempool.space/testnet" : toChain === "SOL" ? "https://explorer.solana.com/?cluster=devnet" : "https://sepolia.etherscan.io",
        nativeSign: toChain === "SOL" ? "Ika Curve25519 EddsaSha512" : "Ika Secp256k1 EcdsaKeccak256",
      },
    });
  }

  return bids;
}
