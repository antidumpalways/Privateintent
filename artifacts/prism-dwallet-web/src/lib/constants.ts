// ─── Brand Colors ────────────────────────────────────────────────────────────
export const P  = "#7c3aed";   // Purple (primary)
export const M  = "#10b981";   // Emerald (accent / success)
export const BG = "#0a0b14";   // Page background

// ─── Token Info ──────────────────────────────────────────────────────────────
export interface TokenInfo {
  symbol: string;
  name: string;
  network: string;
  color: string;
  letter: string;
  chain: string;
}

export const TOKENS: TokenInfo[] = [
  { symbol: "SOL",   name: "Solana",              network: "Devnet",  color: "#9945ff", letter: "◎", chain: "SOL" },
  { symbol: "ETH",   name: "Ethereum",            network: "Sepolia", color: "#627eea", letter: "Ξ",  chain: "ETH" },
  { symbol: "PYUSD", name: "PayPal USD (SOL)",    network: "Devnet",  color: "#003087", letter: "₱",  chain: "SOL" },
  { symbol: "PYUSD", name: "PayPal USD (ETH)",    network: "Sepolia", color: "#009cde", letter: "₱",  chain: "ETH" },
];

export const CHAIN_TOKENS: Record<string, string> = { SOL: "SOL", ETH: "ETH" };

export const SUPPORTED_ROUTES = [
  { from: "SOL",   to: "ETH",   label: "SOL → ETH",       sub: "Solana Devnet → Sepolia" },
  { from: "ETH",   to: "SOL",   label: "ETH → SOL",       sub: "Sepolia → Solana Devnet" },
  { from: "PYUSD", to: "PYUSD", label: "PYUSD → PYUSD",   sub: "SOL Devnet ↔ ETH Sepolia bridge" },
  { from: "PYUSD", to: "ETH",   label: "PYUSD → ETH",     sub: "PayPal USD → Ether (Sepolia)" },
  { from: "ETH",   to: "PYUSD", label: "ETH → PYUSD",     sub: "Ether → PayPal USD (SOL)" },
  { from: "SOL",   to: "PYUSD", label: "SOL → PYUSD",     sub: "Solana → PayPal USD (ETH)" },
  { from: "PYUSD", to: "SOL",   label: "PYUSD → SOL",     sub: "PayPal USD → Solana Devnet" },
];

// ─── Solver Strategy Config ──────────────────────────────────────────────────
export interface StrategyConfig {
  label: string;
  color: string;
  icon: string;
  desc: string;
}

export const STRATEGY_CONFIG: Record<string, StrategyConfig> = {
  aggressive: { label: "AGGRESSIVE", color: "#ef4444", icon: "⚡", desc: "Lowest fee" },
  instant:    { label: "INSTANT",    color: "#0ea5e9", icon: "🚀", desc: "Fastest" },
  premium:    { label: "PREMIUM",    color: "#f59e0b", icon: "💎", desc: "Guaranteed SLA" },
  ai:         { label: "AI AGENT",   color: P,         icon: "🤖", desc: "Claude-powered" },
  custom:     { label: "CUSTOM",     color: "#f59e0b", icon: "⭐", desc: "Community" },
  live:       { label: "LIVE TX",    color: M,         icon: "🟢", desc: "Real on-chain" },
  pyusd:      { label: "PYUSD",      color: "#003087", icon: "₱",  desc: "PayPal USD bridge" },
};

// ─── Status Pipeline ─────────────────────────────────────────────────────────
export interface StatusStep {
  key: string;
  label: string;
  desc: string;
  icon: string;
}

export const STATUS_PIPELINE: StatusStep[] = [
  { key: "encrypted", label: "Intent encrypted",  desc: "Sealed on Encrypt FHE devnet",       icon: "🔒" },
  { key: "bidding",   label: "Solver bidding",     desc: "Blind auction in progress",          icon: "⚔️" },
  { key: "accepted",  label: "Solver accepted",    desc: "",                                    icon: "🤝" },
  { key: "executing", label: "Solver executing",   desc: "Ika MPC signing in progress",        icon: "⚡" },
  { key: "delivered", label: "Token delivered",    desc: "",                                    icon: "📦" },
];

export const STATUS_COLORS: Record<string, string> = {
  pending: "#64748b", encrypted: P, bidding: "#f59e0b",
  accepted: "#0ea5e9", executing: "#f59e0b", delivered: M,
  settled: M, failed: "#ef4444", refunded: "#94a3b8",
};

export const VERDICT_COLORS: Record<string, string> = {
  release: "#64748b", refund: M, partial: "#f59e0b", investigate: "#ef4444",
};

// ─── API ─────────────────────────────────────────────────────────────────────
export const API = import.meta.env.VITE_API_URL ?? "";