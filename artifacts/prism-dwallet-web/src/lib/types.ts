// ─── Solver Types ────────────────────────────────────────────────────────────
export type SolverStrategy = "aggressive" | "instant" | "premium" | "ai" | "custom" | "live";

export interface SolverBid {
  solverId: string; solverName: string; solverDescription: string;
  solverStrategy?: SolverStrategy; fromChain: string; toChain: string;
  fromToken: string; toToken: string; inputAmount: string; outputAmount: string;
  feePercent: number; feeAmount: string; estimatedSeconds: number; reputationScore: number;
  sla?: string; erc7683Compliant?: boolean;
  chainDetails: { network: string; explorerUrl: string; nativeSign: string };
  isCustomSolver?: boolean; operatorAddress?: string;
}

export interface CrossChainOrderView {
  standard?: string;
  orderDataType?: string;
  originChainId?: string;
  destinationChainId?: string;
  inputToken?: string;
  inputAmount?: string;
  outputToken?: string;
  fillDeadline?: string;
  privacyNote?: string;
}

export interface IntentResult {
  intentId: number; status: string; encryptedIntentId: string;
  encryptedIntentHash: string; encryptMode: string;
  crossChainOrder?: CrossChainOrderView; viewingKey?: string; standard?: string;
  bids: SolverBid[]; bestBid: SolverBid; expiresAt: string;
  releaseAfter?: string | null;
  aiSolverIncluded?: boolean; customSolverCount?: number; totalSolvers?: number;
}

export interface RegisteredSolver {
  id: string; name: string; description: string; type: string;
  baseFeePercent: number | string; supportedFromChains: string[]; supportedToChains: string[];
  totalBids?: number; wins?: number; operatorAddress?: string;
}

export interface DisputeResult {
  verdict: "release" | "refund" | "partial" | "investigate";
  confidence: number; reasoning: string; recommendation: string; evidence: string[];
}

// ─── Live Rates ──────────────────────────────────────────────────────────────
export interface LiveRateData {
  prices: { SOL: number; ETH: number; PYUSD: number };
  rates: Record<string, Record<string, number>>;
  source: string;
  fetchedAt: string;
}

// ─── Wallet ──────────────────────────────────────────────────────────────────
export interface AssetRow {
  symbol: string; name: string; color: string; letter: string;
  balance: string; usdStr: string;
}

export interface VaultBalances {
  SOL: number;
  ETH: number;
}

export interface VaultHistoryItem {
  type: "deposit" | "withdraw";
  amount: number;
  token: string;
  ts: string;
  stealthAddress?: string;
}

export interface VaultWithdrawData {
  stealthAddress:  string;
  monitorKey:      string;
  chain:           string;
  network:         string;
  keySource:       string;
  darkPoolOrderId: string;
  releaseAt:       string;
  darkPool: {
    orderId:      string;
    status:       string;
    releaseAt:    string;
    remainingMs:  number;
    remainingMin: number;
    privacyHops:  string[];
  };
}

// ─── Stealth Receive ─────────────────────────────────────────────────────────
export interface SrBalance {
  balance: number;
  balanceUsd: number;
  hasIncoming: boolean;
  lastCheckedAt: string;
}

export interface SrQueueResult {
  status: "queued_in_dark_pool";
  stealthAddress: string;
  chain: string;
  amount: string;
  releaseAt: string;
  remainingMs: number;
  remainingMin: number;
  privacyHops: string[];
  darkPoolNote: string;
}

export interface SrForwardResult {
  success: boolean;
  intentId: number;
  encryptedIntentId: string;
  encryptedIntentHash: string;
  encryptMode: string;
  viewingKey: string;
  stealthAddress: string;
  destinationAddress: string;
  amount: string;
  outputAmount: string;
  feePercent: number;
  feeAmount: string;
  solver: { id: string; name: string; strategy: string; reputationScore: number; estimatedSeconds: number };
  deliveryEta: string;
  privacyProof: { mechanism: string; chainLink: string; encryptLayer: string; ikaSignature: string; onChainTrace: string[] };
  note: string;
}

export interface SrDeliveredResult {
  status: "delivered";
  intentId: number;
  outputAmount: string;
  feePercent: number;
  feeAmount: string;
  encryptedIntentId: string;
  solver: { id: string; name: string; strategy: string; reputationScore: number; estimatedSeconds: number };
  privacyProof: { mechanism: string; chainLink: string; encryptLayer: string; ikaSignature: string; onChainTrace: string[] };
  deliveryEta: string;
  note: string;
}

// ─── Dark Pool ───────────────────────────────────────────────────────────────
export interface DpOrder {
  id: string;
  encHash: string;
  route: string;
  side: string;
  tokenIn: string;
  tokenOut: string;
  amount: string;
  priceLimit?: string;
  status: string;
  matchId?: string;
  matchEncHash?: string;
  sizeDots?: number;
}

export interface DpLastResult {
  matched: boolean;
  message: string;
  encHash: string;
}

// ─── Live Solver Status ──────────────────────────────────────────────────────
export interface LiveSolverStatus {
  name: string;
  addresses: Record<string, string>;
  balances: Array<{
    chain: string;
    network: string;
    address: string;
    balance: string;
    unit: string;
    funded: boolean;
    faucetUrl: string;
  }>;
}