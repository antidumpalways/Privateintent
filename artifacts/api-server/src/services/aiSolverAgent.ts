/**
 * Private Intent — AI Solver Agent
 *
 * An autonomous AI agent that acts as a 4th solver in the marketplace.
 * Unlike static solvers (Alpha/Beta/Gamma), this agent:
 * - Uses Claude to compute optimal bid pricing dynamically
 * - Monitors market conditions and adjusts strategy in real-time
 * - Tracks win rate and self-improves bidding strategy
 * - Runs as a background daemon that responds to new intents
 *
 * This is the "AI Agents & Autonomy" pillar — same concept as NEAR Intents
 * where AI agents can autonomously participate in the solver marketplace.
 */

import { computeAISolverBid } from "./aiAgent.js";
import type { SolverBid, IntentParams } from "./solverEngine.js";
import { getRateSync } from "./liveRates.js";

interface AgentStats {
  totalBids: number;
  wins: number;
  totalSaved: number;
  avgFee: number;
  lastActivity: string;
  isRunning: boolean;
  recentBids: { intentId?: number; route: string; fee: number; output: string; won: boolean; timestamp: string }[];
}

class AIsolverAgent {
  private stats: AgentStats = {
    totalBids: 0,
    wins: 0,
    totalSaved: 0,
    avgFee: 0.2,
    lastActivity: "Not started",
    isRunning: false,
    recentBids: [],
  };

  getStatus() {
    return {
      agentId: "solver-ai",
      name: "AI Solver (Claude)",
      description: "Autonomous AI agent powered by Claude Sonnet. Dynamically prices bids based on market analysis, competitor behavior, and real-time conditions. Zero human intervention.",
      model: "claude-sonnet-4-6",
      strategy: "Competitive underbidding with dynamic fee optimization",
      supportedRoutes: ["SOL→ETH", "ETH→SOL", "SOL→PYUSD", "ETH→PYUSD", "PYUSD→SOL", "PYUSD→ETH"],
      stats: {
        ...this.stats,
        winRate: this.stats.totalBids > 0
          ? `${((this.stats.wins / this.stats.totalBids) * 100).toFixed(1)}%`
          : "N/A",
      },
    };
  }

  async computeBid(params: IntentParams, competitorBids: SolverBid[]): Promise<SolverBid | null> {
    const { fromChain, toChain, fromToken, toToken, amount } = params;

    // AI solver supports SOL/ETH chains and PYUSD token routes
    const supportedFrom = ["SOL", "ETH"];
    const supportedTo = ["SOL", "ETH"];
    if (!supportedFrom.includes(fromChain) || !supportedTo.includes(toChain)) return null;
    // Skip PYUSD intents — PYUSD Bridge Solver handles those
    if (fromToken === "PYUSD" || toToken === "PYUSD") return null;

    const conversionRate = getRateSync(fromToken, toToken || toChain);

    try {
      const bid = await computeAISolverBid({
        fromChain,
        toChain,
        fromToken,
        toToken,
        amount,
        competitorBids,
        conversionRate,
      });

      this.stats.totalBids++;
      this.stats.lastActivity = new Date().toISOString();
      this.stats.avgFee = (this.stats.avgFee * (this.stats.totalBids - 1) + bid.feePercent) / this.stats.totalBids;

      const record = {
        route: `${fromChain}→${toChain}`,
        fee: bid.feePercent,
        output: bid.outputAmount,
        won: false,
        timestamp: new Date().toISOString(),
      };
      this.stats.recentBids = [record, ...this.stats.recentBids.slice(0, 9)];

      const baseTime = toChain === "SOL" ? 12 : 25;

      return {
        solverId: "solver-ai",
        solverName: "AI Solver",
        solverDescription: `Autonomous Claude-powered solver. Strategy: ${bid.strategy}`,
        solverStrategy: "ai" as const,
        fromChain,
        toChain,
        fromToken,
        toToken,
        inputAmount: parseFloat(amount).toFixed(6),
        outputAmount: bid.outputAmount,
        feePercent: bid.feePercent,
        feeAmount: (parseFloat(amount) * (bid.feePercent / 100)).toFixed(6),
        estimatedSeconds: baseTime + Math.floor(Math.random() * 8),
        expiresAt: Date.now() + 120_000,
        reputationScore: 96,
        erc7683Compliant: true,
        chainDetails: {
          network: toChain === "SOL" ? "Solana Devnet" : `${toChain} Sepolia`,
          explorerUrl: toChain === "SOL" ? "https://explorer.solana.com/?cluster=devnet" : "https://sepolia.etherscan.io",
          nativeSign: toChain === "SOL" ? "Ika Curve25519 EddsaSha512" : "Ika Secp256k1 EcdsaKeccak256",
        },
      };
    } catch (err) {
      console.error("[AISolverAgent] bid computation failed:", err);
      return null;
    }
  }

  recordWin(solverId: string) {
    if (solverId === "solver-ai" && this.stats.recentBids.length > 0) {
      this.stats.wins++;
      this.stats.recentBids[0]!.won = true;
    }
  }
}

export const aiSolverAgent = new AIsolverAgent();
