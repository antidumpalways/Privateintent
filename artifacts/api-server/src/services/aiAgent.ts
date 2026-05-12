/**
 * Private Intent — AI Agent Service
 *
 * Provides 4 AI-powered capabilities:
 * 1. Intent Parsing     — Natural language → structured intent params (Chain Abstraction)
 * 2. Route Optimization — Find best multi-hop route across chains
 * 3. AI Solver Agent    — Autonomous solver that monitors pool + submits competitive bids
 * 4. Dispute Resolution — AI judge evaluates delivery disputes
 *
 * All calls use Claude Sonnet via Replit AI Integrations proxy.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";

export interface ParsedIntent {
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  amount: string;
  destinationAddress?: string;
  confidence: number;
  reasoning: string;
}

export interface RouteOptimization {
  recommendedRoute: string;
  hops: string[];
  estimatedSavings: string;
  reasoning: string;
  alternativeRoutes: { route: string; pros: string; cons: string }[];
}

export interface AISolverBid {
  solverId: string;
  solverName: string;
  outputAmount: string;
  feePercent: number;
  strategy: string;
  confidence: number;
}

export interface DisputeVerdict {
  verdict: "release" | "refund" | "partial" | "investigate";
  confidence: number;
  reasoning: string;
  recommendation: string;
  evidence: string[];
}

const SUPPORTED_CHAINS = ["SOL", "ETH", "BTC", "BASE", "ARB"];
const SUPPORTED_ROUTES = [
  "SOL→BTC", "SOL→ETH", "SOL→BASE", "SOL→ARB",
  "ETH→SOL", "BTC→SOL",
];

// ── 1. Intent Parsing ─────────────────────────────────────────────────────────
// Strip markdown code fences that Claude sometimes wraps JSON in
function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1]!.trim();
  return text.trim();
}

export async function parseIntentFromNL(userText: string): Promise<ParsedIntent> {
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `You are an AI for a cross-chain swap intent engine called "Private Intent". 
Parse the user's natural language swap request into structured parameters.

Supported chains: ${SUPPORTED_CHAINS.join(", ")}
Supported routes: ${SUPPORTED_ROUTES.join(", ")}

User request: "${userText}"

Respond ONLY with a valid JSON object (no markdown, no explanation outside JSON):
{
  "fromChain": "SOL",
  "toChain": "BTC",
  "fromToken": "SOL",
  "toToken": "BTC",
  "amount": "0.5",
  "destinationAddress": "",
  "confidence": 0.95,
  "reasoning": "User wants to swap SOL to BTC..."
}

Rules:
- fromToken usually matches fromChain (SOL→SOL, ETH→ETH, BTC→BTC, BASE→ETH, ARB→ETH)
- toToken matches toChain the same way
- If amount is not specified, use "0.1" as default
- If route is not supported, pick the closest supported one and note in reasoning
- confidence is 0.0-1.0 based on how clear the user's intent is`,
      },
    ],
  });

  const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  const text = extractJson(raw);
  try {
    const parsed = JSON.parse(text);
    return {
      fromChain: parsed.fromChain ?? "SOL",
      toChain: parsed.toChain ?? "BTC",
      fromToken: parsed.fromToken ?? "SOL",
      toToken: parsed.toToken ?? "BTC",
      amount: parsed.amount ?? "0.1",
      destinationAddress: parsed.destinationAddress ?? "",
      confidence: parsed.confidence ?? 0.8,
      reasoning: parsed.reasoning ?? "Parsed from user input",
    };
  } catch {
    return {
      fromChain: "SOL", toChain: "BTC", fromToken: "SOL", toToken: "BTC",
      amount: "0.1", confidence: 0.5,
      reasoning: "Could not fully parse — defaulted to SOL→BTC 0.1",
    };
  }
}

// ── 2. Route Optimization ─────────────────────────────────────────────────────
export async function optimizeRoute(params: {
  fromChain: string;
  toChain: string;
  amount: string;
  currentBids: any[];
}): Promise<RouteOptimization> {
  const { fromChain, toChain, amount, currentBids } = params;

  const bidSummary = currentBids.map(b =>
    `${b.solverName}: ${b.outputAmount} ${b.toToken} (fee ${b.feePercent}%, ~${b.estimatedSeconds}s)`
  ).join("\n");

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `You are a DeFi route optimization AI for Private Intent, a cross-chain swap engine on Solana.

Analyze the best route for this swap:
- From: ${fromChain} (amount: ${amount})
- To: ${toChain}
- Current solver bids:
${bidSummary || "No bids yet"}

Available direct routes: ${SUPPORTED_ROUTES.join(", ")}
Note: Multi-hop (e.g. SOL→ETH→BTC) might offer better rates in some cases.

Respond ONLY with valid JSON (no markdown):
{
  "recommendedRoute": "SOL→BTC",
  "hops": ["SOL", "BTC"],
  "estimatedSavings": "0.12% vs average",
  "reasoning": "Direct SOL→BTC via Ika MPC is optimal because...",
  "alternativeRoutes": [
    {"route": "SOL→ETH→BTC", "pros": "More liquidity", "cons": "Higher gas fees on ETH leg"}
  ]
}`,
      },
    ],
  });

  const raw2 = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  const text = extractJson(raw2);
  try {
    const parsed = JSON.parse(text);
    return {
      recommendedRoute: parsed.recommendedRoute ?? `${fromChain}→${toChain}`,
      hops: parsed.hops ?? [fromChain, toChain],
      estimatedSavings: parsed.estimatedSavings ?? "~0.1% vs market",
      reasoning: parsed.reasoning ?? "Direct route is optimal",
      alternativeRoutes: parsed.alternativeRoutes ?? [],
    };
  } catch {
    return {
      recommendedRoute: `${fromChain}→${toChain}`,
      hops: [fromChain, toChain],
      estimatedSavings: "~0.1% vs market",
      reasoning: "Direct route is most efficient for this pair",
      alternativeRoutes: [],
    };
  }
}

// ── 3. AI Solver Autonomous Bid ───────────────────────────────────────────────
export async function computeAISolverBid(params: {
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  amount: string;
  competitorBids: any[];
  conversionRate: number;
}): Promise<AISolverBid> {
  const { fromChain, toChain, fromToken, toToken, amount, competitorBids, conversionRate } = params;

  const competitorSummary = competitorBids.map(b =>
    `${b.solverName}: fee=${b.feePercent}%, output=${b.outputAmount}`
  ).join("\n");

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `You are an autonomous AI solver agent competing in the Private Intent solver marketplace.
Your goal is to WIN the bid by offering the best output amount while remaining profitable.

Intent to bid on:
- Route: ${fromChain} (${fromToken}) → ${toChain} (${toToken})
- Input amount: ${amount} ${fromToken}
- Current market conversion rate: 1 ${fromToken} = ${conversionRate} ${toToken}

Competitor bids:
${competitorSummary || "No competitors yet — be aggressive"}

Your strategy:
- Underbid competitors by 0.05-0.15% on fee to win
- Minimum fee: 0.1% (below this is unprofitable)
- Maximum fee: 0.4% (above this is not competitive)
- Base your fee on market conditions and competitor analysis

Respond ONLY with valid JSON:
{
  "feePercent": 0.22,
  "outputAmount": "0.001120",
  "strategy": "Underbid Alpha Solver by 0.08% — market shows low volatility, safe to price tightly",
  "confidence": 0.88
}`,
      },
    ],
  });

  const raw3 = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  const inputAmt = parseFloat(amount);

  try {
    const parsed = JSON.parse(extractJson(raw3));
    const fee = Math.min(0.4, Math.max(0.1, parsed.feePercent ?? 0.2));
    const output = parsed.outputAmount
      ? parsed.outputAmount
      : ((inputAmt * (1 - fee / 100)) * conversionRate).toFixed(6);

    return {
      solverId: "solver-ai",
      solverName: "AI Solver",
      outputAmount: String(output),
      feePercent: fee,
      strategy: parsed.strategy ?? "Competitive bid based on market analysis",
      confidence: parsed.confidence ?? 0.8,
    };
  } catch {
    const fee = 0.2;
    return {
      solverId: "solver-ai",
      solverName: "AI Solver",
      outputAmount: ((inputAmt * (1 - fee / 100)) * conversionRate).toFixed(6),
      feePercent: fee,
      strategy: "Default competitive strategy",
      confidence: 0.7,
    };
  }
}

// ── 4. Dispute Resolution ─────────────────────────────────────────────────────
export async function evaluateDispute(params: {
  intentId: number;
  fromChain: string;
  toChain: string;
  amount: string;
  deliveryTxId: string;
  proofHash: string;
  solverName: string;
  userClaim: string;
  status: string;
}): Promise<DisputeVerdict> {
  const { intentId, fromChain, toChain, amount, deliveryTxId, proofHash, solverName, userClaim, status } = params;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `You are an AI dispute resolution judge for Private Intent, a cross-chain swap escrow system.

A user is disputing a cross-chain swap. Evaluate the evidence and give a verdict.

Intent details:
- Intent ID: #${intentId}
- Route: ${fromChain} → ${toChain}
- Amount: ${amount} ${fromChain}
- Status: ${status}
- Winning Solver: ${solverName}
- Delivery TX ID: ${deliveryTxId || "NOT PROVIDED"}
- Proof Hash: ${proofHash || "NOT PROVIDED"}

User's dispute claim: "${userClaim}"

Analysis criteria:
1. Is a delivery TX ID present? (sim_* prefix = devnet simulation, valid for demo)
2. Is the proof hash valid (64 hex chars)?
3. Is the status "settled" or "delivered"?
4. Does the user claim seem legitimate based on the data?

Respond ONLY with valid JSON:
{
  "verdict": "release",
  "confidence": 0.92,
  "reasoning": "Delivery TX ID is present and valid. Proof hash matches. The swap completed successfully on devnet. User claim appears unfounded.",
  "recommendation": "The escrow should remain released to the solver as delivery was confirmed.",
  "evidence": [
    "Delivery TX ID present: ${deliveryTxId?.slice(0, 20)}...",
    "Proof hash valid: 64-char hex confirmed",
    "Status is settled — full lifecycle completed"
  ]
}

Verdict options:
- "release": Evidence supports solver, keep escrow released (solver wins)
- "refund": Evidence supports user, refund escrow to user
- "partial": Split — partial refund + partial to solver
- "investigate": Insufficient evidence, manual review needed`,
      },
    ],
  });

  const raw4 = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  try {
    const parsed = JSON.parse(extractJson(raw4));
    return {
      verdict: parsed.verdict ?? "investigate",
      confidence: parsed.confidence ?? 0.5,
      reasoning: parsed.reasoning ?? "Insufficient data for evaluation",
      recommendation: parsed.recommendation ?? "Manual review required",
      evidence: parsed.evidence ?? [],
    };
  } catch {
    return {
      verdict: "investigate",
      confidence: 0.5,
      reasoning: "AI parsing error — manual review required",
      recommendation: "Please contact support with intent ID",
      evidence: [`Intent #${intentId}`, `Status: ${status}`, `TX: ${deliveryTxId}`],
    };
  }
}
