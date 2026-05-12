/**
 * Private Intent — Solver Engine
 *
 * Permissionless solver network dimana solver bersaing untuk fill cross-chain intent.
 * Arsitektur terinspirasi oleh ERC-7683 CrossChainOrder standard.
 *
 * Supported chains (devnet / testnet only):
 *   - SOL Devnet   (native SOL + PYUSD SPL token via Ika Curve25519)
 *   - ETH Sepolia  (native ETH + PYUSD ERC-20 via Ika Secp256k1)
 *
 * Solvers:
 *   - Aggressive Solver: fee terendah
 *   - Instant Solver:    delivery tercepat
 *   - Premium Solver:    guaranteed SLA
 *   - PYUSD Bridge Solver: specialist PayPal USD cross-chain
 */

import { getRateSync } from "./liveRates.js";

export type SolverStrategy = "aggressive" | "instant" | "premium" | "ai" | "custom" | "live" | "pyusd";

export interface SolverProfile {
  id: string;
  name: string;
  description: string;
  strategy: SolverStrategy;
  supportedFromChains: string[];
  supportedToChains: string[];
  /** If set, solver only bids when at least one token is in this list */
  tokenFilter?: string[];
  baseFeePercent: number;
  reputationScore: number;
  totalFilled: number;
  sla?: string;
  erc7683Compliant: boolean;
}

export interface SolverBid {
  solverId: string;
  solverName: string;
  solverDescription: string;
  solverStrategy: SolverStrategy;
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  inputAmount: string;
  outputAmount: string;
  feePercent: number;
  feeAmount: string;
  estimatedSeconds: number;
  expiresAt: number;
  reputationScore: number;
  sla?: string;
  erc7683Compliant: boolean;
  chainDetails: {
    network: string;
    explorerUrl: string;
    nativeSign: string;
  };
}

export interface IntentParams {
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  amount: string;
}

const SOLVERS: SolverProfile[] = [
  {
    id: "solver-alpha",
    name: "Aggressive Solver",
    description: "Selalu underbid kompetitor. Fee terendah di market, harga output terbaik. Cocok untuk swap besar yang memprioritaskan nilai.",
    strategy: "aggressive",
    supportedFromChains: ["SOL", "ETH"],
    supportedToChains: ["ETH", "SOL"],
    baseFeePercent: 0.18,
    reputationScore: 97,
    totalFilled: 2841,
    sla: "Best-effort, 60-120s",
    erc7683Compliant: true,
  },
  {
    id: "solver-beta",
    name: "Instant Solver",
    description: "Delivery tercepat di semua chains. Pre-funded liquidity pools untuk instant settlement. Fee medium, kecepatan premium.",
    strategy: "instant",
    supportedFromChains: ["SOL", "ETH"],
    supportedToChains: ["ETH", "SOL"],
    baseFeePercent: 0.30,
    reputationScore: 95,
    totalFilled: 4127,
    sla: "Guaranteed <30s ETH, <15s SOL",
    erc7683Compliant: true,
  },
  {
    id: "solver-gamma",
    name: "Premium Solver",
    description: "Coverage terluas + guaranteed 25s SLA. Success rate 99.8%. Cocok untuk intent kritikal.",
    strategy: "premium",
    supportedFromChains: ["SOL", "ETH"],
    supportedToChains: ["ETH", "SOL"],
    baseFeePercent: 0.46,
    reputationScore: 99,
    totalFilled: 1203,
    sla: "Guaranteed 25s ETH, 15s SOL",
    erc7683Compliant: true,
  },
  {
    id: "solver-pyusd",
    name: "PYUSD Bridge Solver (PayPal)",
    description:
      "Specialist PayPal USD cross-chain solver. Handles PYUSD(SOL)↔PYUSD(ETH), PYUSD↔SOL, PYUSD↔ETH. " +
      "Contracts: CXk2AMBfi3TwaEL2468s6zP8xq9NxTXjp9gjMgzeUynM (SOL devnet) · " +
      "0xCaC524BcA292aaade2DF8A05cC58F0a65B1B3bB9 (ETH Sepolia). " +
      "Ultra-low 0.15% fee on stablecoin bridge routes.",
    strategy: "pyusd",
    supportedFromChains: ["SOL", "ETH"],
    supportedToChains: ["SOL", "ETH"],
    tokenFilter: ["PYUSD"], // only bids on PYUSD intents
    baseFeePercent: 0.15,
    reputationScore: 98,
    totalFilled: 8732,
    sla: "Guaranteed 15-30s cross-chain",
    erc7683Compliant: true,
  },
];

const CHAIN_DETAILS: Record<string, { network: string; explorerUrl: string; nativeSign: string }> = {
  ETH:   { network: "Ethereum Sepolia", explorerUrl: "https://sepolia.etherscan.io",              nativeSign: "Ika Secp256k1 EcdsaKeccak256" },
  SOL:   { network: "Solana Devnet",    explorerUrl: "https://explorer.solana.com/?cluster=devnet", nativeSign: "Ika Curve25519 EddsaSha512" },
  PYUSD: { network: "Cross-chain",      explorerUrl: "https://explorer.solana.com/?cluster=devnet", nativeSign: "Ika Curve25519 + Secp256k1" },
};

function getConversionRate(fromToken: string, toToken: string): number {
  return getRateSync(fromToken, toToken);
}

function getChainToken(chain: string): string {
  const tokens: Record<string, string> = { SOL: "SOL", ETH: "ETH" };
  return tokens[chain] ?? chain;
}

function getDeliveryTime(strategy: SolverStrategy, toChain: string): number {
  const base: Record<SolverStrategy, Record<string, number>> = {
    aggressive: { ETH: 42, SOL: 20 },
    instant:    { ETH: 12, SOL: 8  },
    premium:    { ETH: 25, SOL: 14 },
    ai:         { ETH: 20, SOL: 12 },
    custom:     { ETH: 35, SOL: 18 },
    live:       { ETH: 25, SOL: 15 },
    pyusd:      { ETH: 22, SOL: 15 },
  };
  const jitter = Math.floor(Math.random() * 8);
  return (base[strategy]?.[toChain] ?? 25) + jitter;
}

export function getSolverBids(params: IntentParams): SolverBid[] {
  const { fromChain, toChain, fromToken, toToken, amount } = params;
  const inputAmt = parseFloat(amount);
  if (isNaN(inputAmt) || inputAmt <= 0) return [];

  const toTokenNorm = toToken || getChainToken(toChain);
  const convRate = getConversionRate(fromToken, toTokenNorm);

  // Use PYUSD chain details when to-token is PYUSD, otherwise use chain details
  const chainDetails = CHAIN_DETAILS[toTokenNorm === "PYUSD" ? "PYUSD" : toChain] ?? CHAIN_DETAILS["ETH"]!;
  const now = Date.now();

  const eligibleSolvers = SOLVERS.filter(s => {
    const chainOk = s.supportedFromChains.includes(fromChain) && s.supportedToChains.includes(toChain);
    if (!chainOk) return false;
    // PYUSD solver only bids on PYUSD intents
    if (s.tokenFilter) {
      return s.tokenFilter.some(t => fromToken === t || toTokenNorm === t);
    }
    // Regular solvers skip PYUSD intents (PYUSD specialist handles those)
    if (fromToken === "PYUSD" || toTokenNorm === "PYUSD") return false;
    return true;
  });

  return eligibleSolvers.map(solver => {
    const jitter = (Math.random() - 0.5) * 0.01 * solver.baseFeePercent;
    const effectiveFee = Math.max(0.05, solver.baseFeePercent + jitter);
    const effectiveFeeAmt = inputAmt * (effectiveFee / 100);
    const effectiveOutput = (inputAmt - effectiveFeeAmt) * convRate;

    return {
      solverId: solver.id,
      solverName: solver.name,
      solverDescription: solver.description,
      solverStrategy: solver.strategy,
      fromChain,
      toChain,
      fromToken,
      toToken: toTokenNorm,
      inputAmount: inputAmt.toFixed(6),
      outputAmount: effectiveOutput.toFixed(6),
      feePercent: parseFloat(effectiveFee.toFixed(3)),
      feeAmount: effectiveFeeAmt.toFixed(6),
      estimatedSeconds: getDeliveryTime(solver.strategy, toChain),
      expiresAt: now + 120_000,
      reputationScore: solver.reputationScore,
      sla: solver.sla,
      erc7683Compliant: solver.erc7683Compliant,
      chainDetails,
    };
  }).sort((a, b) => parseFloat(b.outputAmount) - parseFloat(a.outputAmount));
}

export function getBestBid(bids: SolverBid[]): SolverBid | null {
  return bids[0] ?? null;
}

export function getSolverById(id: string): SolverProfile | undefined {
  return SOLVERS.find(s => s.id === id);
}

export function getAllSolvers(): SolverProfile[] {
  return SOLVERS;
}
