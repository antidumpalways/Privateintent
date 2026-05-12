import React, { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { useWallet } from "@/lib/wallet-context";

const API = import.meta.env.VITE_API_URL ?? "";

const P  = "#7c3aed";
const M  = "#10b981";
const BG = "#0a0b14";

type SolverStrategy = "aggressive" | "instant" | "premium" | "ai" | "custom" | "live";

interface SolverBid {
  solverId: string; solverName: string; solverDescription: string;
  solverStrategy?: SolverStrategy; fromChain: string; toChain: string;
  fromToken: string; toToken: string; inputAmount: string; outputAmount: string;
  feePercent: number; feeAmount: string; estimatedSeconds: number; reputationScore: number;
  sla?: string; erc7683Compliant?: boolean;
  chainDetails: { network: string; explorerUrl: string; nativeSign: string };
  isCustomSolver?: boolean; operatorAddress?: string;
}

interface CrossChainOrderView {
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

interface IntentResult {
  intentId: number; status: string; encryptedIntentId: string;
  encryptedIntentHash: string; encryptMode: string;
  crossChainOrder?: CrossChainOrderView; viewingKey?: string; standard?: string;
  bids: SolverBid[]; bestBid: SolverBid; expiresAt: string;
  releaseAfter?: string | null;
  aiSolverIncluded?: boolean; customSolverCount?: number; totalSolvers?: number;
}

interface RegisteredSolver {
  id: string; name: string; description: string; type: string;
  baseFeePercent: number | string; supportedFromChains: string[]; supportedToChains: string[];
  totalBids?: number; wins?: number; operatorAddress?: string;
}

interface DisputeResult {
  verdict: "release" | "refund" | "partial" | "investigate";
  confidence: number; reasoning: string; recommendation: string; evidence: string[];
}

const SUPPORTED_ROUTES = [
  { from: "SOL",   to: "ETH",   label: "SOL → ETH",       sub: "Solana Devnet → Sepolia" },
  { from: "ETH",   to: "SOL",   label: "ETH → SOL",       sub: "Sepolia → Solana Devnet" },
  { from: "PYUSD", to: "PYUSD", label: "PYUSD → PYUSD",   sub: "SOL Devnet ↔ ETH Sepolia bridge" },
  { from: "PYUSD", to: "ETH",   label: "PYUSD → ETH",     sub: "PayPal USD → Ether (Sepolia)" },
  { from: "ETH",   to: "PYUSD", label: "ETH → PYUSD",     sub: "Ether → PayPal USD (SOL)" },
  { from: "SOL",   to: "PYUSD", label: "SOL → PYUSD",     sub: "Solana → PayPal USD (ETH)" },
  { from: "PYUSD", to: "SOL",   label: "PYUSD → SOL",     sub: "PayPal USD → Solana Devnet" },
];

const CHAIN_TOKENS: Record<string, string> = { SOL: "SOL", ETH: "ETH" };

/** chain = the actual blockchain network identifier (SOL or ETH) */
interface TokenInfo { symbol: string; name: string; network: string; color: string; letter: string; chain: string; }
const TOKENS: TokenInfo[] = [
  { symbol: "SOL",   name: "Solana",              network: "Devnet",  color: "#9945ff", letter: "◎", chain: "SOL" },
  { symbol: "ETH",   name: "Ethereum",            network: "Sepolia", color: "#627eea", letter: "Ξ",  chain: "ETH" },
  { symbol: "PYUSD", name: "PayPal USD (SOL)",    network: "Devnet",  color: "#003087", letter: "₱",  chain: "SOL" },
  { symbol: "PYUSD", name: "PayPal USD (ETH)",    network: "Sepolia", color: "#009cde", letter: "₱",  chain: "ETH" },
];

interface LiveRateData {
  prices: { SOL: number; ETH: number; PYUSD: number };
  rates: Record<string, Record<string, number>>;
  source: string;
  fetchedAt: string;
}

const STRATEGY_CONFIG: Record<string, { label: string; color: string; icon: string; desc: string }> = {
  aggressive: { label: "AGGRESSIVE", color: "#ef4444", icon: "⚡", desc: "Lowest fee" },
  instant:    { label: "INSTANT",    color: "#0ea5e9", icon: "🚀", desc: "Fastest" },
  premium:    { label: "PREMIUM",    color: "#f59e0b", icon: "💎", desc: "Guaranteed SLA" },
  ai:         { label: "AI AGENT",   color: P,         icon: "🤖", desc: "Claude-powered" },
  custom:     { label: "CUSTOM",     color: "#f59e0b", icon: "⭐", desc: "Community" },
  live:       { label: "LIVE TX",    color: M,         icon: "🟢", desc: "Real on-chain" },
  pyusd:      { label: "PYUSD",      color: "#003087", icon: "₱",  desc: "PayPal USD bridge" },
};

const STATUS_PIPELINE = [
  { key: "encrypted", label: "Intent encrypted",  desc: "Sealed on Encrypt FHE devnet",       icon: "🔒" },
  { key: "bidding",   label: "Solver bidding",     desc: "Blind auction in progress",          icon: "⚔️" },
  { key: "accepted",  label: "Solver accepted",    desc: "",                                    icon: "🤝" },
  { key: "executing", label: "Solver executing",   desc: "Ika MPC signing in progress",        icon: "⚡" },
  { key: "delivered", label: "Token delivered",    desc: "",                                    icon: "📦" },
];

function chip(txt: string, color: string) {
  return (
    <span style={{
      fontSize: "10px", fontWeight: 700, letterSpacing: "0.4px",
      background: `${color}1a`, color, border: `1px solid ${color}35`,
      borderRadius: "999px", padding: "2px 9px",
    }}>{txt}</span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "#64748b", encrypted: P, bidding: "#f59e0b",
    accepted: "#0ea5e9", executing: "#f59e0b", delivered: M,
    settled: M, failed: "#ef4444", refunded: "#94a3b8",
  };
  const c = map[status] ?? "#64748b";
  const pulse = ["bidding","executing","accepted"].includes(status);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: c,
        boxShadow: `0 0 6px ${c}`, display: "inline-block",
        animation: pulse ? "pulse 1.5s infinite" : "none" }} />
      <span style={{ color: c, fontWeight: 600, fontSize: "13px", textTransform: "capitalize" }}>{status}</span>
    </span>
  );
}

function StepIndicator({ current }: { current: string }) {
  const steps = [
    { key: "connect", label: "Connect", short: "1" },
    { key: "dwallet", label: "dWallet", short: "2" },
  ];
  const idx = steps.findIndex(s => s.key === current);
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: "32px" }}>
      {steps.map((s, i) => {
        const done   = i < idx;
        const active = i === idx;
        return (
          <React.Fragment key={s.key}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
              <div style={{
                width: "34px", height: "34px", borderRadius: "50%",
                background: done ? `linear-gradient(135deg,${P},${M})` : active ? `${P}22` : "rgba(255,255,255,0.06)",
                border: active ? `2px solid ${P}` : done ? "none" : "1.5px solid rgba(255,255,255,0.12)",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.35s",
                boxShadow: active ? `0 0 0 4px ${P}20` : "none",
              }}>
                {done ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2.5 7l3 3 6-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <span style={{ fontSize: "12px", fontWeight: 700,
                    color: active ? P : "#475569" }}>{s.short}</span>
                )}
              </div>
              <span className="step-label" style={{
                fontSize: "10px", fontWeight: 600, letterSpacing: "0.3px",
                color: active ? "#e2e8f0" : done ? "#64748b" : "#334155",
              }}>{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 1, height: "2px", margin: "0 4px",
                background: i < idx ? `linear-gradient(90deg,${P},${M})` : "rgba(255,255,255,0.07)",
                transition: "background 0.4s", position: "relative", top: "-9px",
              }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function SolverRace({ bids, winner }: { bids: SolverBid[]; winner: string | null }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 80); return () => clearTimeout(t); }, []);

  const maxOut = Math.max(...bids.map(b => parseFloat(b.outputAmount)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {bids.map((bid, i) => {
        const pct = (parseFloat(bid.outputAmount) / maxOut) * 100;
        const isWinner = winner === bid.solverId || (!winner && i === 0);
        const isLive = bid.solverName?.includes("Live Solver") || bid.solverId?.includes("live-solver");
        const isAI   = bid.solverId === "solver-ai";
        const isCustom = bid.isCustomSolver && !isLive;
        const strategy = isLive ? "live" : (bid.solverStrategy ?? (isAI ? "ai" : isCustom ? "custom" : "premium"));
        const sc = STRATEGY_CONFIG[strategy] ?? STRATEGY_CONFIG["custom"]!;

        const borderC = isWinner ? `${M}50` : strategy === "aggressive" ? "#ef444430" :
          strategy === "instant" ? "#0ea5e930" : isLive ? `${M}35` : isAI ? `${P}35` : "rgba(255,255,255,0.07)";
        const barGrad = isWinner ? `linear-gradient(90deg,${P},${M})`
          : strategy === "aggressive" ? "linear-gradient(90deg,#ef4444,#f59e0b)"
          : strategy === "instant" ? "linear-gradient(90deg,#0ea5e9,#38bdf8)"
          : isLive ? `linear-gradient(90deg,${M},#0ea5e9)`
          : isAI ? `linear-gradient(90deg,${P},#6366f1)`
          : isCustom ? "linear-gradient(90deg,#f59e0b,#d97706)"
          : "rgba(255,255,255,0.12)";

        return (
          <div key={bid.solverId} style={{
            background: isWinner ? `${M}08` : "rgba(255,255,255,0.025)",
            border: `1px solid ${borderC}`,
            borderRadius: "14px", padding: "16px 18px",
            boxShadow: isWinner ? `0 0 20px ${M}12` : "none",
            transition: "box-shadow 0.4s",
            animation: `rise 0.35s ${i * 0.07}s ease both`,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                {/* Avatar circle */}
                <div style={{ width: "32px", height: "32px", borderRadius: "50%", flexShrink: 0,
                  background: `${sc.color}20`, border: `1.5px solid ${sc.color}40`,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px" }}>
                  {sc.icon}
                </div>
                {isWinner && <span style={{ fontSize: "14px" }}>🏆</span>}
                <span style={{ fontWeight: 700, fontSize: "14px", color: "#f1f5f9" }}>{bid.solverName}</span>
                {chip(sc.label, sc.color)}
                {bid.erc7683Compliant && chip("ERC-7683", "#6366f1")}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "18px", fontWeight: 800, fontFamily: "'Space Mono', monospace",
                  color: isWinner ? M : "#f1f5f9" }}>
                  {parseFloat(bid.outputAmount).toFixed(6)}
                  <span style={{ fontSize: "12px", fontWeight: 600, marginLeft: "4px", color: "#94a3b8" }}>{bid.toToken}</span>
                </div>
                <div style={{ fontSize: "11px", color: "#475569" }}>Fee {bid.feePercent}% · ~{bid.estimatedSeconds}s</div>
              </div>
            </div>

            {/* Progress bar */}
            <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: "6px", height: "6px", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: "6px",
                width: mounted ? `${pct}%` : "0%",
                background: barGrad,
                transition: `width 0.9s cubic-bezier(.22,1,.36,1) ${i * 0.1}s`,
              }} />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "7px" }}>
              <span style={{ fontSize: "11px", color: "#334155" }}>{bid.chainDetails.nativeSign}</span>
              {bid.sla && (
                <span style={{ fontSize: "10px", color: "#475569", background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.07)", borderRadius: "4px", padding: "1px 7px" }}>
                  SLA: {bid.sla}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TrackingTimeline({ trackingStatus, intentResult }: { trackingStatus: any; intentResult: IntentResult | null }) {
  const isFailed = ["failed","refunded"].includes(trackingStatus.status);
  const statusOrder = ["encrypted","bidding","accepted","executing","delivered"];
  const currentIdx = Math.max(0, statusOrder.indexOf(
    trackingStatus.status === "settled" ? "delivered" : isFailed ? "encrypted" : trackingStatus.status
  ));

  const rawTxId = trackingStatus.deliveryTxId ?? "";
  const pipeIdx = rawTxId.indexOf("|");
  const txId = pipeIdx > -1 ? rawTxId.slice(0, pipeIdx) : rawTxId;
  const explorerUrl = pipeIdx > -1 ? rawTxId.slice(pipeIdx + 1) : "";
  const isLive = !!explorerUrl && !txId.startsWith("sim_");

  const nodes = STATUS_PIPELINE.map((item, i) => {
    const done    = !isFailed && (i < currentIdx || (i === currentIdx && ["delivered","settled"].includes(trackingStatus.status)));
    const active  = !isFailed && i === currentIdx && !["delivered","settled"].includes(trackingStatus.status);
    const failed  = isFailed && i === 0;
    let desc = item.desc;
    if (item.key === "accepted")  desc = trackingStatus.solverId ?? "—";
    if (item.key === "delivered") desc = txId ? `${txId.slice(0,18)}…` : "Pending";
    return { ...item, done, active, failed, desc };
  });

  return (
    <div style={{ position: "relative" }}>
      {/* Failed/refunded terminal banner */}
      {isFailed && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px",
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
          borderRadius: "10px", padding: "10px 14px", marginBottom: "20px" }}>
          <span style={{ fontSize: "18px" }}>⚠️</span>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#f87171" }}>
              {trackingStatus.status === "refunded" ? "Intent refunded" : "Intent failed"}
            </div>
            <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
              {trackingStatus.failureReason ?? "No solver accepted within the auction window."}
            </div>
          </div>
        </div>
      )}

      {/* Animated line */}
      <div style={{ position: "absolute", left: "15px", top: isFailed ? "82px" : "16px", bottom: "16px", width: "2px",
        background: "rgba(255,255,255,0.07)", borderRadius: "1px" }}>
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0,
          height: isFailed ? "0%" : `${Math.min(100, (currentIdx / (nodes.length - 1)) * 100)}%`,
          background: `linear-gradient(to bottom, ${P}, ${M})`,
          borderRadius: "1px", transition: "height 0.8s ease",
        }} />
      </div>

      {nodes.map((item, i) => (
        <div key={item.key} style={{
          display: "flex", gap: "18px", alignItems: "flex-start",
          paddingBottom: i < nodes.length - 1 ? "24px" : "0",
        }}>
          <div style={{
            width: "32px", height: "32px", flexShrink: 0,
            background: item.failed ? "rgba(239,68,68,0.15)"
              : item.done ? `linear-gradient(135deg, ${P}, ${M})` : "rgba(255,255,255,0.06)",
            border: item.failed ? "1.5px solid rgba(239,68,68,0.5)"
              : item.active ? `2px solid ${P}` : item.done ? "none" : "1.5px solid rgba(255,255,255,0.1)",
            borderRadius: "50%", position: "relative", zIndex: 2,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: item.failed ? "0 0 12px rgba(239,68,68,0.2)"
              : item.active ? `0 0 0 4px ${P}20` : item.done ? `0 0 12px ${M}30` : "none",
            transition: "all 0.4s",
          }}>
            {item.failed ? (
              <span style={{ fontSize: "13px" }}>✕</span>
            ) : item.done ? (
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path d="M2.5 7l3 3 6-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : item.active ? (
              <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: P,
                animation: "pulse 1.2s infinite" }} />
            ) : (
              <span style={{ fontSize: "13px" }}>{item.icon}</span>
            )}
          </div>

          <div style={{ paddingTop: "4px", flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
              <span style={{ fontSize: "13px", fontWeight: 600,
                color: item.failed ? "#f87171" : item.done ? "#f1f5f9" : "#475569" }}>{item.label}</span>
              {item.failed && <span style={{ fontSize: "9px", fontWeight: 700, color: "#f87171",
                background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: "4px", padding: "1px 6px" }}>FAILED</span>}
              {item.done && <span style={{ fontSize: "9px", fontWeight: 700, color: M,
                background: `${M}18`, border: `1px solid ${M}30`, borderRadius: "4px", padding: "1px 6px" }}>✓</span>}
            </div>
            {item.desc && (
              <div style={{ fontSize: "11px", color: "#334155", fontFamily: item.key === "delivered" ? "'Space Mono', monospace" : "inherit" }}>
                {item.key === "delivered" && isLive && explorerUrl ? (
                  <a href={explorerUrl} target="_blank" rel="noreferrer"
                    style={{ color: M, textDecoration: "none", fontWeight: 600 }}>
                    {txId.slice(0,20)}… ↗
                  </a>
                ) : item.desc}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}


function TimeLockCountdown({ releaseAt }: { releaseAt: string }) {
  const [rem, setRem] = React.useState(() => new Date(releaseAt).getTime() - Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setRem(new Date(releaseAt).getTime() - Date.now()), 1000);
    return () => clearInterval(t);
  }, [releaseAt]);
  const done = rem <= 0;
  const mins = Math.max(0, Math.floor(rem / 60000));
  const secs = Math.max(0, Math.floor((rem % 60000) / 1000));
  return (
    <div style={{ background: done ? "#10b98110" : "rgba(249,115,22,0.07)",
      border: `1px solid ${done ? "#10b98128" : "rgba(249,115,22,0.25)"}`,
      borderRadius: "10px", padding: "10px 14px", marginBottom: "14px",
      display: "flex", alignItems: "center", gap: "10px" }}>
      <span style={{ fontSize: "18px" }}>{done ? "✅" : "⏱️"}</span>
      <div>
        <div style={{ fontSize: "12px", fontWeight: 700, color: done ? "#10b981" : "#fb923c" }}>
          {done ? "Time lock released — executing" : `Executes in ${mins}m ${secs}s`}
        </div>
        <div style={{ fontSize: "10px", color: "#64748b" }}>
          Release at: {new Date(releaseAt).toLocaleString()}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [, navigate] = useLocation();
  const { phantomPubkey, phantomEthAddress, connected, connectPhantom, connecting,
    dwalletId, setDwalletId, dwalletAddresses, setDwalletAddresses } = useWallet();

  const [step, setStep] = useState<"connect" | "dwallet" | "dashboard" | "intent" | "tracking" | "darkpool" | "vault" | "stealth">("connect");
  const [creatingDwallet, setCreatingDwallet] = useState(false);
  const [dwalletSubStep, setDwalletSubStep] = useState<"idle" | "signing" | "signed" | "dkg" | "done">("idle");
  const [dwalletError, setDwalletError] = useState("");

  const [nlText, setNlText] = useState("");
  const [nlParsing, setNlParsing] = useState(false);
  const [fromChain, setFromChain] = useState("SOL");
  const [toChain, setToChain] = useState("ETH");
  const [amount, setAmount] = useState("0.1");
  const [submitting, setSubmitting] = useState(false);

  const [intentResult, setIntentResult] = useState<IntentResult | null>(null);
  const [selectedSolver, setSelectedSolver] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  const [trackingStatus, setTrackingStatus] = useState<any>(null);
  const [pollTimer, setPollTimer] = useState<ReturnType<typeof setInterval> | null>(null);

  const [copiedHash, setCopiedHash] = useState(false);

  const [showDispute, setShowDispute] = useState(false);
  const [disputeClaim, setDisputeClaim] = useState("");
  const [disputing, setDisputing] = useState(false);
  const [disputeResult, setDisputeResult] = useState<DisputeResult | null>(null);

  const [showPrivacyProof, setShowPrivacyProof] = useState(false);
  const [copiedEncId, setCopiedEncId] = useState(false);

  const [showHistory, setShowHistory] = useState(false);
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [showSolverPortal, setShowSolverPortal] = useState(false);
  const [solverList, setSolverList] = useState<RegisteredSolver[]>([]);
  const [loadingSolvers, setLoadingSolvers] = useState(false);
  const [liveSolverStatus, setLiveSolverStatus] = useState<{
    name: string; addresses: Record<string,string>;
    balances: Array<{ chain: string; network: string; address: string; balance: string; unit: string; funded: boolean; faucetUrl: string }>;
  } | null>(null);
  const [airdropping, setAirdropping] = useState(false);
  const [airdropMsg, setAirdropMsg] = useState("");
  const [regName, setRegName] = useState("");
  const [regDesc, setRegDesc] = useState("");
  const [regAddress, setRegAddress] = useState("");
  const [regFee, setRegFee] = useState("0.20");
  const [regFrom, setRegFrom] = useState("SOL");
  const [regTo, setRegTo] = useState("ETH");
  const [regStrategy, setRegStrategy] = useState("");
  const [registering, setRegistering] = useState(false);
  const [regResult, setRegResult] = useState<{ id: string; name: string } | null>(null);
  const [regError, setRegError] = useState("");

  // ── Token selector state ──────────────────────────────────────────────────
  const [fromToken, setFromToken] = useState<TokenInfo>(TOKENS[0]);
  const [toToken,   setToToken]   = useState<TokenInfo>(TOKENS[1]);
  const [fromAmount, setFromAmount] = useState("");
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker,   setShowToPicker]   = useState(false);
  const fromPickerRef = useRef<HTMLDivElement>(null);
  const toPickerRef   = useRef<HTMLDivElement>(null);

  // ── Wallet asset list ─────────────────────────────────────────────────────
  interface AssetRow { symbol: string; name: string; color: string; letter: string; balance: string; usdStr: string; }
  const [walletAssets, setWalletAssets] = useState<AssetRow[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);

  // ── Stealth Address — Universal chain-aware (inbound privacy) ───────────────
  const [srAddress, setSrAddress]           = useState(""); // generated stealth receive addr
  const [srCopied, setSrCopied]             = useState(false);
  const [srGenerating, setSrGenerating]     = useState(false);
  const [srMonitorKey, setSrMonitorKey]     = useState(""); // secret from backend — required for /forward
  const [srBalance, setSrBalance]           = useState<{ balance: number; balanceUsd: number; hasIncoming: boolean; lastCheckedAt: string } | null>(null);
  const [srPolling, setSrPolling]           = useState(false);
  const [srForwarding, setSrForwarding]     = useState(false);
  type SrForwardResult = {
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
  };
  const [srForwardResult, setSrForwardResult] = useState<SrForwardResult | null>(null);
  const [srChain, setSrChain]               = useState<"SOL" | "ETH">("SOL"); // chain of active stealth address
  const [srTabChain, setSrTabChain]         = useState<"SOL" | "ETH">("SOL"); // chain selector in Private Drop tab
  type SrQueueResult = {
    status: "queued_in_dark_pool";
    stealthAddress: string;
    chain: string;
    amount: string;
    releaseAt: string;
    remainingMs: number;
    remainingMin: number;
    privacyHops: string[];
    darkPoolNote: string;
  };
  type SrDeliveredResult = {
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
  };
  const [srQueueResult, setSrQueueResult]   = useState<SrQueueResult | null>(null);
  const [srDelivered, setSrDelivered]       = useState<SrDeliveredResult | null>(null);
  const [srStatusPhase, setSrStatusPhase]   = useState<"idle" | "queued" | "processing" | "delivered">("idle");

  // ── Dark Pool ─────────────────────────────────────────────────────────────
  const [darkPoolData, setDarkPoolData] = useState<any[]>([]);
  const [darkPoolLoading, setDarkPoolLoading] = useState(false);
  const [dpTab, setDpTab] = useState<"book" | "place">("book");
  const [dpSide, setDpSide] = useState<"sell" | "buy">("sell");
  const [dpTokenIn, setDpTokenIn] = useState("SOL");
  const [dpTokenOut, setDpTokenOut] = useState("ETH");
  const [dpAmount, setDpAmount] = useState("");
  const [dpPrice, setDpPrice] = useState("");
  const [dpSubmitting, setDpSubmitting] = useState(false);
  const [dpMyOrders, setDpMyOrders] = useState<any[]>([]);
  const [dpLastResult, setDpLastResult] = useState<{ matched: boolean; message: string; encHash: string } | null>(null);

  // ── Live rates (CoinGecko, refreshed every 60 s) ─────────────────────────
  const [liveRateData, setLiveRateData] = useState<LiveRateData | null>(null);

  const getRate = (from: string, to: string): number =>
    liveRateData?.rates?.[from]?.[to] ?? 0;
  const getPrice = (sym: string): number => {
    if (sym === "PYUSD") return 1;
    return (liveRateData?.prices as Record<string, number> | undefined)?.[sym] ?? (sym === "ETH" ? 2650 : 150);
  };

  // ── Timed-release ─────────────────────────────────────────────────────────
  const [timeLockEnabled, setTimeLockEnabled] = useState(false);
  const [timeLockDate, setTimeLockDate] = useState("");

  // ── Vault ─────────────────────────────────────────────────────────────────
  const [vaultBalance, setVaultBalance] = useState<{ SOL: number; ETH: number }>({ SOL: 0, ETH: 0 });
  const [vaultLoading, setVaultLoading] = useState(false);
  const [vaultHistory, setVaultHistory] = useState<any[]>([]);
  const [vaultDepositAmt, setVaultDepositAmt] = useState("");
  const [vaultWithdrawAmt, setVaultWithdrawAmt] = useState("");
  const [vaultToken, setVaultToken] = useState<"SOL" | "ETH">("SOL");
  type VaultWithdrawData = {
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
  };
  const [vaultWithdrawData, setVaultWithdrawData]           = useState<VaultWithdrawData | null>(null);
  const [vaultWithdrawDpPhase, setVaultWithdrawDpPhase]     = useState<"queued" | "processing" | "delivered" | null>(null);
  const [vaultWithdrawDelivered, setVaultWithdrawDelivered] = useState<any>(null);
  const [vaultWithdrawPolling, setVaultWithdrawPolling]     = useState(false);
  const [vaultDepositing, setVaultDepositing] = useState(false);
  const [vaultWithdrawing, setVaultWithdrawing] = useState(false);
  const [vaultRevealed, setVaultRevealed] = useState(false);

  // Computed estimated output
  const toAmountEst = useMemo(() => {
    const n = parseFloat(fromAmount);
    if (!fromAmount || isNaN(n) || n <= 0) return "";
    const rate = getRate(fromToken.symbol, toToken.symbol);
    if (!rate) return "";
    return (n * rate * 0.995).toFixed(6);
  }, [fromAmount, fromToken, toToken, liveRateData]);

  // Fetch live rates from backend (CoinGecko, 60 s cache)
  useEffect(() => {
    const load = () =>
      fetch(`${API}/api/rates`)
        .then(r => r.ok ? r.json() : null)
        .then((d: LiveRateData | null) => { if (d) setLiveRateData(d); })
        .catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  // Sync token picker → fromChain/toChain/amount
  // Use token.chain (blockchain) not token.symbol (e.g. PYUSD lives on SOL or ETH)
  useEffect(() => { setFromChain(fromToken.chain); }, [fromToken]);
  useEffect(() => { setToChain(toToken.chain); }, [toToken]);
  useEffect(() => { if (fromAmount) setAmount(fromAmount); }, [fromAmount]);

  // Clear stealth address when destination chain changes — address format differs per chain
  useEffect(() => {
    const newChain: "SOL" | "ETH" = (toToken.chain === "ETH") ? "ETH" : "SOL";
    if (srAddress && srChain !== newChain) {
      setSrAddress(""); setSrMonitorKey(""); setSrBalance(null);
      setSrForwardResult(null); setSrQueueResult(null); setSrDelivered(null); setSrStatusPhase("idle");
      setSrChain(newChain);
    } else if (!srAddress) {
      setSrChain(newChain);
    }
  }, [toToken]);

  // Close pickers on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (fromPickerRef.current && !fromPickerRef.current.contains(e.target as Node)) setShowFromPicker(false);
      if (toPickerRef.current   && !toPickerRef.current.contains(e.target as Node))   setShowToPicker(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Fetch devnet SOL balance + Sepolia ETH balance for Home page
  useEffect(() => {
    if (!phantomPubkey || step !== "dashboard") return;
    setAssetsLoading(true);
    (async () => {
      try {
        // SOL — Solana devnet
        const solRpc = await fetch("https://api.devnet.solana.com", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [phantomPubkey] }),
        });
        const solData = await solRpc.json();
        const lamports: number = solData.result?.value ?? 0;
        const solBal = lamports / 1e9;

        // ETH — Sepolia testnet (use phantomEthAddress if available)
        let ethBal = 0;
        if (phantomEthAddress) {
          try {
            const ethRpc = await fetch("https://ethereum-sepolia-rpc.publicnode.com", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_getBalance",
                params: [phantomEthAddress, "latest"] }),
            });
            const ethData = await ethRpc.json();
            const weiHex: string = ethData.result ?? "0x0";
            ethBal = parseInt(weiHex, 16) / 1e18;
          } catch {}
        }

        setWalletAssets([
          { symbol: "SOL", name: "Solana (Devnet)",   color: "#9945ff", letter: "◎",
            balance: solBal.toFixed(4), usdStr: solBal > 0 ? `~$${(solBal * getPrice("SOL")).toFixed(2)}` : "$0.00" },
          { symbol: "ETH", name: "Ethereum (Sepolia)", color: "#627eea", letter: "Ξ",
            balance: ethBal.toFixed(4), usdStr: ethBal > 0 ? `~$${(ethBal * getPrice("ETH")).toFixed(2)}` : "$0.00" },
        ]);
      } catch {
        setWalletAssets([
          { symbol: "SOL", name: "Solana (Devnet)",   color: "#9945ff", letter: "◎", balance: "—", usdStr: "—" },
          { symbol: "ETH", name: "Ethereum (Sepolia)", color: "#627eea", letter: "Ξ", balance: "—", usdStr: "—" },
        ]);
      } finally { setAssetsLoading(false); }
    })();
  }, [phantomPubkey, phantomEthAddress, step]);

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const res = await fetch(`${API}/api/intent/history`);
      const data = await res.json();
      setHistoryData(data.history ?? []);
    } catch {} finally { setLoadingHistory(false); }
  }

  async function loadSolvers() {
    setLoadingSolvers(true);
    try {
      const [solRes, liveRes] = await Promise.all([
        fetch(`${API}/api/solver/list`),
        fetch(`${API}/api/solver/live/status`),
      ]);
      const solData = await solRes.json();
      setSolverList(solData.solvers ?? []);
      if (liveRes.ok) setLiveSolverStatus(await liveRes.json());
    } catch {} finally { setLoadingSolvers(false); }
  }

  async function handleAirdrop(chain: string) {
    setAirdropping(true); setAirdropMsg("");
    try {
      const res = await fetch(`${API}/api/solver/live/airdrop`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chain }),
      });
      const data = await res.json();
      if (data.success) {
        setAirdropMsg(`✅ Airdrop OK! Balance: ${data.balanceAfter} ${chain}`);
        const liveRes = await fetch(`${API}/api/solver/live/status`);
        if (liveRes.ok) setLiveSolverStatus(await liveRes.json());
      } else {
        setAirdropMsg(`⚠️ ${data.error ?? "Airdrop failed"}`);
      }
    } catch (e: any) { setAirdropMsg(`⚠️ ${e.message}`); }
    finally { setAirdropping(false); }
  }

  async function handleRegisterSolver() {
    if (!regName.trim() || !regAddress.trim()) return;
    setRegistering(true); setRegError(""); setRegResult(null);
    try {
      const res = await fetch(`${API}/api/solver/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: regName, description: regDesc, operatorAddress: regAddress,
          baseFeePercent: parseFloat(regFee), supportedFromChains: [regFrom], supportedToChains: [regTo], strategy: regStrategy }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Registration failed");
      setRegResult({ id: data.solver.id, name: data.solver.name });
      loadSolvers();
    } catch (e: any) { setRegError(e.message); }
    finally { setRegistering(false); }
  }

  useEffect(() => {
    if (connected && step === "connect") setStep(dwalletId ? "intent" : "dwallet");
  }, [connected, dwalletId]);

  useEffect(() => {
    if (!phantomPubkey) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/api/dwallet/${phantomPubkey}`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          const solAddr = data.addresses?.sol ?? "";
          const walletId = `sec:${data.secp256kWalletId}+c25:${data.curve25519WalletId}`;
          setDwalletId(walletId);
          setDwalletAddresses({ eth: "", btc: "", sol: solAddr });
          setStep(prev => (prev === "connect" || prev === "dwallet") ? "dashboard" : prev);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [phantomPubkey]);

  useEffect(() => () => { if (pollTimer) clearInterval(pollTimer); }, [pollTimer]);

  const darkPoolIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (step === "darkpool") {
      loadDarkPool(); loadMyDarkPoolOrders(); setDpLastResult(null);
      darkPoolIntervalRef.current = setInterval(() => { loadDarkPool(); loadMyDarkPoolOrders(); }, 5000);
    } else {
      if (darkPoolIntervalRef.current) { clearInterval(darkPoolIntervalRef.current); darkPoolIntervalRef.current = null; }
    }
    return () => { if (darkPoolIntervalRef.current) clearInterval(darkPoolIntervalRef.current); };
  }, [step]);

  useEffect(() => {
    if (step === "vault" && phantomPubkey) loadVaultData();
  }, [step, phantomPubkey]);

  // ── Stealth Receive balance + dark pool status polling ────────────────────
  const srPollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (step === "stealth" && srAddress) {
      const poll = async () => {
        setSrPolling(true);
        try {
          const r = await fetch(`${API}/api/stealth/receive/balance/${srAddress}`);
          if (r.ok) { const d = await r.json(); setSrBalance(d); }
        } catch { /* silent */ } finally { setSrPolling(false); }
      };
      poll();
      srPollRef.current = setInterval(poll, 5000);
    } else {
      if (srPollRef.current) { clearInterval(srPollRef.current); srPollRef.current = null; }
      if (statusPollRef.current) { clearInterval(statusPollRef.current); statusPollRef.current = null; }
    }
    return () => {
      if (srPollRef.current) { clearInterval(srPollRef.current); srPollRef.current = null; }
      if (statusPollRef.current) { clearInterval(statusPollRef.current); statusPollRef.current = null; }
    };
  }, [step, srAddress]);

  async function handleConnect() {
    try { await connectPhantom(); } catch (e: any) { alert(e.message); }
  }

  async function handleCreateDwallet() {
    setCreatingDwallet(true); setDwalletSubStep("idle"); setDwalletError("");
    try {
      if (!phantomPubkey) throw new Error("Phantom not connected");
      const checkRes = await fetch(`${API}/api/dwallet/${phantomPubkey}`);
      if (checkRes.ok) {
        const existing = await checkRes.json();
        setDwalletSubStep("done");
        setDwalletId(`sec:${existing.secp256kWalletId}+c25:${existing.curve25519WalletId}`);
        setDwalletAddresses({ eth: "", btc: "", sol: existing.addresses?.sol ?? "" });
        setStep("dashboard"); return;
      }
      setDwalletSubStep("signing");
      if (!window.solana?.signMessage) throw new Error("Phantom signMessage not available.");
      const authMessage = [
        "Authorize Ika dWallet Creation", "",
        "Action: Generate MPC keypair via Ika DKG",
        `Phantom: ${phantomPubkey}`,
        `Timestamp: ${new Date().toISOString()}`, "",
        "This signature authorizes the server to run DKG on your behalf.",
        "No funds will be moved. No transaction will be broadcast.",
      ].join("\n");
      const msgBytes = new TextEncoder().encode(authMessage);
      const { signature } = await window.solana.signMessage(msgBytes, "utf8");
      const phantomSignature = Buffer.from(signature).toString("hex");
      setDwalletSubStep("signed");
      setDwalletSubStep("dkg");
      const res = await fetch(`${API}/api/dwallet/create`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phantomPubkey, phantomSignature }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "DKG failed");
      setDwalletSubStep("done");
      setDwalletId(`sec:${data.secp256kWalletId}+c25:${data.curve25519WalletId}`);
      setDwalletAddresses({ eth: "", btc: "", sol: data.addresses?.sol ?? "" });
      setStep("dashboard");
    } catch (e: any) {
      setDwalletSubStep("idle");
      const msg: string = e.message ?? String(e);
      setDwalletError(msg.includes("User rejected") || msg.includes("rejected")
        ? "Signature rejected. Please approve the Phantom popup to authorize your dWallet."
        : msg);
    } finally { setCreatingDwallet(false); }
  }

  async function handleSmartSubmit() {
    let fc = fromChain, tc = toChain, amt = amount;
    if (nlText.trim()) {
      setNlParsing(true);
      try {
        const res = await fetch(`${API}/api/intent/parse`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: nlText }),
        });
        const d = await res.json();
        if (res.ok) {
          const p = d.parsed;
          fc = p.fromChain; setFromChain(p.fromChain);
          tc = p.toChain;   setToChain(p.toChain);
          amt = p.amount;   setAmount(p.amount);
        }
      } catch {} finally { setNlParsing(false); }
    }
    if (!amt || parseFloat(amt) <= 0) { alert("Masukkan jumlah yang valid"); return; }
    setSubmitting(true);
    try {
      const fromToken = CHAIN_TOKENS[fc] ?? fc;
      const toToken   = CHAIN_TOKENS[tc] ?? tc;
      const defaultDest = tc === "ETH" || tc === "BASE" || tc === "ARB"
        ? phantomEthAddress : tc === "SOL" ? phantomPubkey : "";
      const destAddress = defaultDest || undefined;
      const submitRes = await fetch(`${API}/api/intent/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phantomPubkey: phantomPubkey || "demo-pubkey",
          fromChain: fc, toChain: tc, fromToken, toToken, amount: amt,
          destinationAddress: destAddress,
          releaseAfter: timeLockEnabled && timeLockDate
            ? new Date(timeLockDate).toISOString() : undefined }),
      });
      const submitData = await submitRes.json();
      if (!submitRes.ok) throw new Error(submitData.error ?? "Submit failed");
      setIntentResult(submitData);
      const bestSolverId = submitData.bestBid?.solverId ?? null;
      setSelectedSolver(bestSolverId);
      await _lockEscrowAndAccept(submitData, bestSolverId, amt);
    } catch (e: any) { alert(e.message); setSubmitting(false); }
  }

  async function _lockEscrowAndAccept(result: IntentResult, solverId: string | null, amt: string) {
    if (!solverId) { setSubmitting(false); return; }
    setAccepting(true);
    try {
      const cfgRes = await fetch(`${API}/api/escrow/config`);
      if (!cfgRes.ok) throw new Error("Gagal fetch escrow config");
      const cfg = await cfgRes.json();
      const { Connection, Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } =
        await import("@solana/web3.js");
      const connection = new Connection(cfg.rpcUrl, "confirmed");
      const lamports = Math.round(parseFloat(amt) * LAMPORTS_PER_SOL);
      if (!lamports || lamports <= 0) throw new Error("Jumlah tidak valid untuk escrow");
      const { blockhash } = await connection.getLatestBlockhash();
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: new PublicKey(phantomPubkey) }).add(
        SystemProgram.transfer({ fromPubkey: new PublicKey(phantomPubkey),
          toPubkey: new PublicKey(cfg.escrowPubkey), lamports })
      );
      if (!window.solana) throw new Error("Phantom tidak terkoneksi");
      const signed = await window.solana.signTransaction(tx);
      const rawTx = signed.serialize();
      const sourceTxId = await connection.sendRawTransaction(rawTx, { skipPreflight: false });
      await connection.confirmTransaction(sourceTxId, "confirmed");
      const acceptRes = await fetch(`${API}/api/intent/accept`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intentId: result.intentId, solverId,
          dwalletId: dwalletId ?? undefined, sourceTxId }),
      });
      const acceptData = await acceptRes.json();
      if (!acceptRes.ok) throw new Error(acceptData.error ?? "Accept failed");
      setTrackingStatus(acceptData);
      setStep("tracking");
      startPolling(result.intentId);
    } catch (e: any) { alert(e.message); }
    finally { setAccepting(false); setSubmitting(false); }
  }

  function startPolling(id: number) {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/intent/${id}`);
        const data = await res.json();
        setTrackingStatus((prev: any) => ({ ...prev, ...data }));
        if (["settled","failed","refunded"].includes(data.status)) clearInterval(timer);
      } catch {}
    }, 2500);
    setPollTimer(timer);
  }

  async function handleDispute() {
    if (!intentResult || !disputeClaim.trim()) return;
    setDisputing(true); setDisputeResult(null);
    try {
      const res = await fetch(`${API}/api/intent/dispute`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intentId: intentResult.intentId, userClaim: disputeClaim }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDisputeResult(data.verdict);
    } catch (e: any) { alert("Dispute failed: " + e.message); }
    finally { setDisputing(false); }
  }

  function resetApp() {
    setStep("dashboard"); setIntentResult(null); setSelectedSolver(null);
    setTrackingStatus(null); setNlText(""); setShowDispute(false);
    setDisputeResult(null); setDisputeClaim("");
    setShowPrivacyProof(false); setCopiedEncId(false);
    setTimeLockEnabled(false); setTimeLockDate("");
    setVaultWithdrawResult(null);
    if (pollTimer) clearInterval(pollTimer); setPollTimer(null);
  }

  async function handleGenerateStealthTab() {
    if (!phantomPubkey) return;
    setSrGenerating(true); setSrCopied(false); setSrBalance(null); setSrForwardResult(null);
    try {
      const r = await fetch(`${API}/api/stealth/receive/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phantomPubkey, chain: srTabChain }),
      });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      setSrAddress(d.stealthAddress);
      setSrChain(d.chain ?? srTabChain);
      setSrMonitorKey(d.monitorKey ?? "");
    } catch (e: any) { alert("Stealth address generation failed: " + e.message); }
    finally { setSrGenerating(false); }
  }

  async function handleForwardStealthTab() {
    if (!srAddress || !phantomPubkey || !srBalance || !srMonitorKey) return;
    setSrForwarding(true);
    try {
      const r = await fetch(`${API}/api/stealth/receive/forward`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stealthAddress:     srAddress,
          ownerPhantomPubkey: phantomPubkey,
          monitorKey:         srMonitorKey,
          amount:             srBalance.balance,
        }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Forward failed"); }
      const d = await r.json();
      if (d.status === "queued_in_dark_pool") {
        setSrQueueResult(d);
        setSrStatusPhase("queued");
        setSrBalance(null);
        // Start polling /status every 6 seconds — pass monitorKey for ownership auth
        const queuedAddr = srAddress;
        const queuedKey  = srMonitorKey;
        const pollStatus = async () => {
          try {
            const sr = await fetch(`${API}/api/stealth/receive/status/${queuedAddr}?monitorKey=${encodeURIComponent(queuedKey)}`);
            if (!sr.ok) return;
            const sd = await sr.json();
            if (sd.status === "processing") {
              setSrStatusPhase("processing");
            } else if (sd.status === "delivered") {
              setSrStatusPhase("delivered");
              setSrDelivered(sd);
              clearInterval(statusPollRef.current!);
              statusPollRef.current = null;
              setSrAddress("");
              setSrMonitorKey("");
            } else if (sd.status === "queued_in_dark_pool") {
              setSrQueueResult(prev => prev ? { ...prev, remainingMs: sd.remainingMs, remainingMin: sd.remainingMin } : prev);
            }
          } catch { /* silent */ }
        };
        pollStatus(); // fire immediately — handles already-expired delay edge case
        statusPollRef.current = setInterval(pollStatus, 6000);
      } else {
        // Fallback: immediate delivery response (should not happen with new backend)
        setSrForwardResult(d);
        setSrBalance(null);
        setSrAddress("");
        setSrMonitorKey("");
      }
    } catch (e: any) { alert("Forward failed: " + e.message); }
    finally { setSrForwarding(false); }
  }

  async function loadDarkPool() {
    setDarkPoolLoading(true);
    try {
      const res = await fetch(`${API}/api/darkpool/book`);
      if (res.ok) { const data = await res.json(); setDarkPoolData(data.orders ?? []); }
    } catch { /* silent */ } finally { setDarkPoolLoading(false); }
  }

  async function loadMyDarkPoolOrders() {
    if (!phantomPubkey) return;
    try {
      const res = await fetch(`${API}/api/darkpool/myorders?pubkey=${encodeURIComponent(phantomPubkey)}`);
      if (res.ok) { const d = await res.json(); setDpMyOrders(d.orders ?? []); }
    } catch { /* silent */ }
  }

  async function handlePlaceDarkPoolOrder() {
    if (!phantomPubkey || !dpAmount) return;
    setDpSubmitting(true); setDpLastResult(null);
    try {
      const res = await fetch(`${API}/api/darkpool/order`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phantomPubkey,
          side: dpSide,
          tokenIn: dpTokenIn,
          tokenOut: dpTokenOut,
          amount: dpAmount,
          priceLimit: dpPrice || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setDpLastResult({ matched: data.status === "matched", message: data.message, encHash: data.encHash });
        setDpAmount(""); setDpPrice("");
        await Promise.all([loadDarkPool(), loadMyDarkPoolOrders()]);
        if (data.status !== "matched") setDpTab("book");
      } else { alert(data.error ?? "Failed to place order"); }
    } catch (e: any) { alert(e.message); }
    finally { setDpSubmitting(false); }
  }

  async function handleCancelDarkPoolOrder(orderId: string) {
    if (!phantomPubkey) return;
    try {
      const res = await fetch(`${API}/api/darkpool/order/${orderId}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phantomPubkey }),
      });
      if (res.ok) { await Promise.all([loadDarkPool(), loadMyDarkPoolOrders()]); }
    } catch { /* silent */ }
  }

  async function loadVaultData() {
    if (!phantomPubkey) return;
    setVaultLoading(true);
    try {
      const [balRes, histRes] = await Promise.all([
        fetch(`${API}/api/vault/balance?address=${phantomPubkey}`),
        fetch(`${API}/api/vault/history?address=${phantomPubkey}`),
      ]);
      if (balRes.ok) { const d = await balRes.json(); setVaultBalance(d.balance ?? { SOL: 0, ETH: 0 }); }
      if (histRes.ok) { const d = await histRes.json(); setVaultHistory(d.history ?? []); }
    } catch { /* silent */ } finally { setVaultLoading(false); }
  }

  async function signVaultChallenge(pubkey: string): Promise<{ nonce: string; signature: string }> {
    const challengeRes = await fetch(`${API}/api/vault/challenge?address=${encodeURIComponent(pubkey)}`);
    if (!challengeRes.ok) throw new Error("Failed to fetch vault challenge");
    const { nonce, message } = await challengeRes.json();
    const msgBytes = new TextEncoder().encode(message);
    const solana = (window as any).solana;
    if (!solana?.signMessage) throw new Error("Phantom wallet not available for signing");
    const { signature: sigBytes } = await solana.signMessage(msgBytes, "utf8");
    const signature = Array.from(sigBytes as Uint8Array).map((b: number) => b.toString(16).padStart(2, "0")).join("");
    return { nonce, signature };
  }

  async function handleVaultDeposit() {
    if (!phantomPubkey || !vaultDepositAmt) return;
    setVaultDepositing(true);
    try {
      const { nonce, signature } = await signVaultChallenge(phantomPubkey);
      const res = await fetch(`${API}/api/vault/deposit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: phantomPubkey, token: vaultToken, amount: vaultDepositAmt, nonce, signature }),
      });
      const data = await res.json();
      if (res.ok) { setVaultBalance(data.balance); setVaultDepositAmt(""); await loadVaultData(); }
      else alert(data.error ?? "Deposit failed");
    } catch (e: any) { alert(e.message); }
    finally { setVaultDepositing(false); }
  }

  async function handleVaultWithdraw() {
    if (!phantomPubkey || !vaultWithdrawAmt) return;
    setVaultWithdrawing(true);
    setVaultWithdrawResult(null);
    setVaultWithdrawData(null);
    setVaultWithdrawDpPhase(null);
    setVaultWithdrawDelivered(null);
    try {
      const { nonce, signature } = await signVaultChallenge(phantomPubkey);
      const res = await fetch(`${API}/api/vault/withdraw`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: phantomPubkey, token: vaultToken, amount: vaultWithdrawAmt, nonce, signature }),
      });
      const data = await res.json();
      if (res.ok) {
        setVaultBalance(data.balance);
        setVaultWithdrawResult(data.stealthAddress);
        setVaultWithdrawData({
          stealthAddress:  data.stealthAddress,
          monitorKey:      data.monitorKey,
          chain:           data.chain,
          network:         data.network,
          keySource:       data.keySource,
          darkPoolOrderId: data.darkPoolOrderId,
          releaseAt:       data.releaseAt,
          darkPool:        data.darkPool,
        });
        setVaultWithdrawDpPhase("queued");
        setVaultWithdrawPolling(true);
        setVaultWithdrawAmt("");
        await loadVaultData();
      } else alert(data.error ?? "Withdraw failed");
    } catch (e: any) { alert(e.message); }
    finally { setVaultWithdrawing(false); }
  }

  // ── Poll dark pool status for vault withdraw ──────────────────────────────
  useEffect(() => {
    if (!vaultWithdrawPolling || !vaultWithdrawData) return;
    if (vaultWithdrawDpPhase === "delivered") { setVaultWithdrawPolling(false); return; }
    const { stealthAddress, monitorKey } = vaultWithdrawData;
    const interval = setInterval(async () => {
      try {
        const r = await fetch(`${API}/api/stealth/receive/status/${stealthAddress}?monitorKey=${monitorKey}`);
        if (!r.ok) return;
        const d = await r.json();
        if (d.status === "queued_in_dark_pool") {
          setVaultWithdrawDpPhase("queued");
        } else if (d.status === "processing") {
          setVaultWithdrawDpPhase("processing");
        } else if (d.status === "delivered") {
          setVaultWithdrawDpPhase("delivered");
          setVaultWithdrawDelivered(d);
          setVaultWithdrawPolling(false);
          clearInterval(interval);
        } else if (d.status === "failed") {
          setVaultWithdrawPolling(false);
          clearInterval(interval);
        }
      } catch { /* silent */ }
    }, 5_000);
    return () => clearInterval(interval);
  }, [vaultWithdrawPolling, vaultWithdrawData, vaultWithdrawDpPhase]);

  /* ── Styles ──────────────────────────────────────────────────── */
  const card: React.CSSProperties = {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "20px", padding: "28px",
  };

  const inp: React.CSSProperties = {
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "10px", padding: "10px 14px", color: "#e2e8f0", fontSize: "14px",
    width: "100%", boxSizing: "border-box", outline: "none",
  };

  const primaryBtn: React.CSSProperties = {
    background: `linear-gradient(135deg, ${P}, ${M})`,
    color: "#fff", fontWeight: 800, fontSize: "16px",
    padding: "15px 28px", borderRadius: "12px", border: "none", cursor: "pointer",
    width: "100%", transition: "opacity 0.2s, transform 0.15s",
    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
  };

  const verdictColor: Record<string, string> = {
    release: "#64748b", refund: M, partial: "#f59e0b", investigate: "#ef4444",
  };

  const glStr = `
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
    @keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
    select option{background:#0e1122;color:#e2e8f0}
    .pi-input:focus{border-color:${P}60!important;box-shadow:0 0 0 3px ${P}14}
    .pri-btn:hover{opacity:0.9;transform:translateY(-1px)}
    .pri-btn:active{transform:translateY(0)}
    /* Step labels: show on desktop, hide on mobile */
    .step-label{display:block}
    @media(max-width:480px){.step-label{display:none}}
    /* Mobile bottom bar */
    .mobile-bottom-bar{display:none}
    @media(max-width:600px){
      .mobile-bottom-bar{display:flex;position:fixed;bottom:0;left:0;right:0;z-index:50;
        padding:12px 16px 20px;background:linear-gradient(to top,${BG} 60%,transparent);
        flex-direction:column;gap:8px}
      .hide-on-mobile{display:none!important}
      .main-scroll-pad{padding-bottom:120px!important}
    }
    /* Sidebar nav button hover */
    .sidebar-nav-btn:hover{background:rgba(255,255,255,0.04)!important;color:#94a3b8!important}
    /* Sidebar hidden on mobile */
    @media(max-width:600px){
      aside{display:none!important}
      .main-scroll-pad{padding-left:16px!important;padding-right:16px!important}
    }
  `;

  const addrFmt = (s: string) => s ? `${s.slice(0,4)}…${s.slice(-4)}` : "";

  return (
    <div style={{ background: BG, minHeight: "100vh", color: "#e2e8f0",
      fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{glStr}</style>

      {/* Ambient */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 0 }}>
        <div style={{ position: "absolute", top: "5%", right: "10%", width: "480px", height: "480px",
          background: `radial-gradient(ellipse, ${P}10 0%, transparent 65%)` }} />
        <div style={{ position: "absolute", bottom: "10%", left: "5%", width: "360px", height: "360px",
          background: `radial-gradient(ellipse, ${M}0a 0%, transparent 65%)` }} />
      </div>

      {/* Navbar */}
      <nav style={{ position: "relative", zIndex: 10, borderBottom: "1px solid rgba(255,255,255,0.06)",
        padding: "0 24px", display: "flex", justifyContent: "space-between", alignItems: "center", height: "60px" }}>
        <button onClick={() => navigate("/")} style={{
          background: "none", border: "none", cursor: "pointer",
          fontWeight: 800, fontSize: "16px", letterSpacing: "-0.4px", color: "#f1f5f9",
        }}>
          Private Intent
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {connected && phantomPubkey && (
            <div style={{ fontSize: "12px", color: "#64748b", background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "5px 12px",
              display: "flex", alignItems: "center", gap: "5px" }}>
              <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: M,
                display: "inline-block" }} />
              {addrFmt(phantomPubkey)}
            </div>
          )}
        </div>
      </nav>

      {/* ── Setup wizard (connect + dwallet) ── */}
      {(step === "connect" || step === "dwallet") && (
      <div className="main-scroll-pad" style={{ maxWidth: "540px", margin: "40px auto 120px", padding: "0 16px", position: "relative", zIndex: 1 }}>
        <StepIndicator current={step} />

        {/* ── Connect ── */}
        {step === "connect" && (
          <div style={{ ...card, animation: "rise 0.4s ease both", textAlign: "center" }}>
            <div style={{ fontSize: "52px", marginBottom: "20px", animation: "float 3s ease-in-out infinite",
              display: "inline-block" }}>👻</div>
            <h2 style={{ fontSize: "24px", fontWeight: 800, marginBottom: "12px", color: "#f1f5f9",
              letterSpacing: "-0.5px" }}>Connect Phantom</h2>
            <p style={{ color: "#64748b", fontSize: "14px", lineHeight: 1.75, marginBottom: "32px",
              maxWidth: "340px", margin: "0 auto 32px" }}>
              Your Phantom address becomes the owner of your Ika dWallet.
              No separate seed phrase — one wallet controls all chains.
            </p>
            <button onClick={handleConnect} disabled={connecting} className="pri-btn hide-on-mobile" style={primaryBtn}>
              {connecting ? (
                <>
                  <span style={{ width: "16px", height: "16px", border: "2px solid rgba(255,255,255,0.4)",
                    borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite",
                    display: "inline-block" }} />
                  Connecting…
                </>
              ) : "Connect Phantom Wallet"}
            </button>
            <p style={{ fontSize: "12px", color: "#334155", marginTop: "16px" }}>
              Don't have Phantom?{" "}
              <a href="https://phantom.app" target="_blank" rel="noreferrer"
                style={{ color: P, fontWeight: 600 }}>Install here →</a>
            </p>
            {/* Per-step trust indicators */}
            <div style={{ display: "flex", justifyContent: "center", gap: "12px", marginTop: "20px", flexWrap: "wrap" }}>
              {[
                { label: "Non-custodial", color: M },
                { label: "No seed phrase", color: P },
                { label: "Phantom secure", color: "#64748b" },
              ].map(t => (
                <span key={t.label} style={{ fontSize: "10px", fontWeight: 600, color: t.color,
                  background: `${t.color}12`, border: `1px solid ${t.color}28`,
                  borderRadius: "999px", padding: "3px 10px" }}>{t.label}</span>
              ))}
            </div>
          </div>
        )}

        {/* ── dWallet ── */}
        {step === "dwallet" && (
          <div style={{ ...card, animation: "rise 0.4s ease both" }}>
            <div style={{ marginBottom: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ width: "36px", height: "36px", borderRadius: "10px",
                background: `${P}18`, border: `1px solid ${P}30`,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px" }}>🔗</div>
              <h2 style={{ fontSize: "20px", fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.4px" }}>
                Create Ika dWallet
              </h2>
            </div>
            <p style={{ color: "#64748b", fontSize: "13px", lineHeight: 1.7, marginBottom: "24px" }}>
              Ika DKG generates an MPC keypair from your Phantom authority.
              One key → native ETH + SOL addresses. Zero bridges.
            </p>

            {/* Sub-step track */}
            <div style={{ display: "flex", gap: "0", marginBottom: "24px",
              borderRadius: "12px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
              {([
                { key: "signing", label: "Authorize", icon: "✍️", desc: "Phantom popup" },
                { key: "dkg",     label: "Ika DKG",   icon: "⚙️", desc: "MPC key gen" },
                { key: "done",    label: "Ready",      icon: "✅", desc: "Keys live" },
              ] as const).map(({ key, label, icon, desc }) => {
                const isDone = (key === "signing" && ["signed","dkg","done"].includes(dwalletSubStep))
                  || (key === "dkg" && dwalletSubStep === "done") || dwalletSubStep === "done";
                const isActive = dwalletSubStep === key || (key === "signing" && dwalletSubStep === "signed");
                return (
                  <div key={key} style={{ flex: 1, padding: "14px 10px", textAlign: "center",
                    background: isDone ? `${M}10` : isActive ? `${P}14` : "rgba(255,255,255,0.025)",
                    borderRight: "1px solid rgba(255,255,255,0.06)", transition: "background 0.3s" }}>
                    <div style={{ fontSize: "20px", marginBottom: "4px" }}>{isDone ? "✅" : isActive ? "⏳" : icon}</div>
                    <div style={{ fontSize: "11px", fontWeight: 700,
                      color: isDone ? M : isActive ? P : "#475569" }}>{label}</div>
                    <div style={{ fontSize: "10px", color: "#334155", marginTop: "2px" }}>{desc}</div>
                  </div>
                );
              })}
            </div>

            {creatingDwallet && (
              <div style={{ background: `${P}0e`, border: `1px solid ${P}28`,
                borderRadius: "12px", padding: "14px 16px", marginBottom: "16px",
                fontSize: "13px", color: "#c4b5fd",
                display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⚙️</span>
                {dwalletSubStep === "signing" && "Waiting for Phantom signature approval…"}
                {dwalletSubStep === "signed"  && "Signature received. Starting Ika DKG…"}
                {dwalletSubStep === "dkg"     && "Ika MPC running DKG — generating ETH + SOL keys…"}
              </div>
            )}

            {dwalletError && (
              <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)",
                borderRadius: "10px", padding: "12px 16px", marginBottom: "16px",
                fontSize: "13px", color: "#fca5a5" }}>
                {dwalletError}
              </div>
            )}

            <button onClick={handleCreateDwallet} disabled={creatingDwallet} className="pri-btn hide-on-mobile" style={primaryBtn}>
              {creatingDwallet
                ? (dwalletSubStep === "signing" ? "Waiting for Phantom…" : "Running Ika DKG…")
                : "Create dWallet via Ika MPC"}
            </button>

            <div style={{ marginTop: "16px", padding: "12px 14px", background: "rgba(255,255,255,0.025)",
              borderRadius: "10px", fontSize: "12px", color: "#475569", lineHeight: 1.7 }}>
              <strong style={{ color: "#64748b" }}>What you'll sign:</strong> An off-chain authorization message.
              No SOL spent. Phantom shows the full message before asking for approval.
            </div>

            {/* Trust badges */}
            <div style={{ display: "flex", gap: "8px", marginTop: "16px", flexWrap: "wrap" }}>
              {[
                { label: "✓ MPC keypair", color: P },
                { label: "✓ Ika DKG network", color: M },
                { label: "✓ No bridge required", color: "#0ea5e9" },
              ].map(t => (
                <span key={t.label} style={{ fontSize: "10px", fontWeight: 600, color: t.color,
                  background: `${t.color}12`, border: `1px solid ${t.color}28`,
                  borderRadius: "999px", padding: "3px 10px" }}>{t.label}</span>
              ))}
            </div>
          </div>
        )}

          {/* Mobile bottom bar — setup only */}
          <div className="mobile-bottom-bar">
            {step === "connect" && (
              <button onClick={handleConnect} disabled={connecting} className="pri-btn" style={primaryBtn}>
                {connecting ? (
                  <><span style={{ width: "16px", height: "16px", border: "2px solid rgba(255,255,255,0.4)",
                    borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite",
                    display: "inline-block" }} />Connecting…</>
                ) : "Connect Phantom Wallet"}
              </button>
            )}
            {step === "dwallet" && (
              <button onClick={handleCreateDwallet} disabled={creatingDwallet} className="pri-btn" style={primaryBtn}>
                {creatingDwallet ? (dwalletSubStep === "signing" ? "Waiting for Phantom…" : "Running Ika DKG…") : "Create dWallet via Ika MPC"}
              </button>
            )}
          </div>
        </div>
      )} {/* end setup wizard */}

      {/* ── App sidebar layout ── */}
      {!["connect", "dwallet"].includes(step) && (
        <div style={{ display: "flex", minHeight: "calc(100vh - 60px)", position: "relative", zIndex: 1 }}>

          {/* Sidebar */}
          <aside style={{ width: "220px", flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.06)",
            display: "flex", flexDirection: "column", padding: "24px 16px",
            position: "sticky", top: 0, height: "calc(100vh - 60px)",
            background: "rgba(255,255,255,0.015)" }}>

            <div style={{ marginBottom: "28px", padding: "0 4px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, color: "#334155",
                textTransform: "uppercase", letterSpacing: "1px" }}>Workspace</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1 }}>
              {([
                { key: "dashboard" as const, label: "Home",      icon: "⬡" },
                { key: "intent"    as const, label: "Swap",      icon: "↗" },
                { key: "stealth"   as const, label: "Private Drop", icon: "🫧" },
                { key: "darkpool"  as const, label: "Dark Pool", icon: "🌑" },
                { key: "vault"     as const, label: "Vault",     icon: "🔒" },
              ]).map(item => (
                <button key={item.key} onClick={() => setStep(item.key)}
                  className={step === item.key ? "" : "sidebar-nav-btn"}
                  style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "9px 12px", borderRadius: "9px", border: "none", cursor: "pointer",
                    background: step === item.key ? `${P}14` : "transparent",
                    color: step === item.key ? "#c4b5fd" : "#475569",
                    fontWeight: step === item.key ? 600 : 400, fontSize: "14px",
                    textAlign: "left", transition: "all 0.15s", width: "100%",
                  }}>
                  <span style={{ fontSize: "15px", width: "18px", textAlign: "center", flexShrink: 0 }}>{item.icon}</span>
                  {item.label}
                </button>
              ))}
              <button onClick={() => { setShowHistory(true); loadHistory(); }}
                className="sidebar-nav-btn" style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "9px 12px", borderRadius: "9px", border: "none", cursor: "pointer",
                  background: "transparent", color: "#475569", fontWeight: 400, fontSize: "14px",
                  textAlign: "left", transition: "all 0.15s", width: "100%",
                }}>
                <span style={{ fontSize: "15px", width: "18px", textAlign: "center", flexShrink: 0 }}>📋</span>
                History
              </button>
              <button onClick={() => { setShowSolverPortal(true); loadSolvers(); }}
                className="sidebar-nav-btn" style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "9px 12px", borderRadius: "9px", border: "none", cursor: "pointer",
                  background: "transparent", color: "#475569", fontWeight: 400, fontSize: "14px",
                  textAlign: "left", transition: "all 0.15s", width: "100%",
                }}>
                <span style={{ fontSize: "15px", width: "18px", textAlign: "center", flexShrink: 0 }}>⭐</span>
                Solvers
              </button>
            </div>

            <div style={{ padding: "12px 14px", background: "rgba(255,255,255,0.03)",
              borderRadius: "12px", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: "10px", color: "#334155", marginBottom: "6px",
                textTransform: "uppercase", letterSpacing: "0.5px" }}>Wallet</div>
              <div style={{ fontSize: "11px", color: "#64748b", fontFamily: "'Space Mono', monospace", marginBottom: "4px" }}>
                {addrFmt(phantomPubkey)}
              </div>
              {dwalletAddresses?.sol && (
                <div style={{ fontSize: "10px", color: "#334155", fontFamily: "'Space Mono', monospace" }}>
                  dWallet: {addrFmt(dwalletAddresses.sol)}
                </div>
              )}
            </div>
          </aside>

          {/* Main content */}
          <div className="main-scroll-pad" style={{ flex: 1, padding: "32px 32px 120px", minWidth: 0 }}>

            {/* ── Dashboard / Home ── */}
            {step === "dashboard" && (
              <div style={{ animation: "rise 0.35s ease both", maxWidth: "560px" }}>
                {/* Header */}
                <div style={{ marginBottom: "22px" }}>
                  <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#f1f5f9",
                    letterSpacing: "-0.5px", marginBottom: "4px" }}>Portfolio</h1>
                  <p style={{ fontSize: "12px", color: "#475569", fontFamily: "'Space Mono', monospace" }}>
                    {addrFmt(phantomPubkey)} · Phantom Wallet
                  </p>
                </div>

                {/* Total value card */}
                <div style={{ ...card, marginBottom: "14px",
                  background: `linear-gradient(135deg, ${P}18 0%, ${M}10 100%)`,
                  border: `1px solid ${P}28` }}>
                  <div style={{ fontSize: "10px", color: "#64748b", textTransform: "uppercase",
                    letterSpacing: "1px", marginBottom: "6px" }}>Total Portfolio Value</div>
                  <div style={{ fontSize: "30px", fontWeight: 900, color: "#f1f5f9", letterSpacing: "-1px" }}>
                    {assetsLoading ? "—" : (() => {
                      const total = walletAssets.reduce((acc, a) => {
                        const v = parseFloat(a.usdStr.replace(/[$,]/g, "") || "0");
                        return acc + (isNaN(v) ? 0 : v);
                      }, 0);
                      return total.toLocaleString("en-US", { style: "currency", currency: "USD" });
                    })()}
                  </div>
                  <div style={{ fontSize: "11px", color: "#475569", marginTop: "4px" }}>Mainnet · Live balance</div>
                </div>

                {/* Asset list card */}
                <div style={{ ...card, padding: 0, overflow: "hidden", marginBottom: "14px" }}>
                  <div style={{ padding: "13px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)",
                    display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "#475569",
                      textTransform: "uppercase", letterSpacing: "1px" }}>Assets</span>
                    {assetsLoading && (
                      <span style={{ fontSize: "11px", color: "#334155" }}>Fetching…</span>
                    )}
                  </div>
                  {assetsLoading ? (
                    <div style={{ padding: "24px 18px", display: "flex", flexDirection: "column", gap: "14px" }}>
                      {[1,2,3,4].map(i => (
                        <div key={i} style={{ display: "flex", gap: "14px", alignItems: "center" }}>
                          <div style={{ width: "40px", height: "40px", borderRadius: "50%",
                            background: "rgba(255,255,255,0.06)", flexShrink: 0 }} />
                          <div style={{ flex: 1, height: "14px", borderRadius: "6px",
                            background: "rgba(255,255,255,0.05)" }} />
                          <div style={{ width: "60px", height: "14px", borderRadius: "6px",
                            background: "rgba(255,255,255,0.05)" }} />
                        </div>
                      ))}
                    </div>
                  ) : walletAssets.length === 0 ? (
                    <div style={{ padding: "24px", textAlign: "center", color: "#334155", fontSize: "13px" }}>
                      No assets found
                    </div>
                  ) : walletAssets.map((a, i) => (
                    <div key={a.symbol} style={{
                      display: "flex", alignItems: "center", gap: "14px",
                      padding: "14px 18px",
                      borderBottom: i < walletAssets.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                    }}>
                      <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: a.color,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "16px", fontWeight: 900, color: "#fff", flexShrink: 0 }}>
                        {a.letter}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "15px", fontWeight: 700, color: "#f1f5f9" }}>{a.symbol}</div>
                        <div style={{ fontSize: "11px", color: "#475569", marginTop: "2px" }}>{a.name}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "15px", fontWeight: 700, color: "#f1f5f9" }}>{a.balance}</div>
                        <div style={{ fontSize: "11px", color: "#475569", marginTop: "2px" }}>{a.usdStr}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Privacy chips */}
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "20px" }}>
                  {[
                    { label: "FHE encrypted", ok: true },
                    { label: "dWallet MPC",   ok: !!dwalletId },
                    { label: "Blind auction", ok: true },
                  ].map(p => (
                    <span key={p.label} style={{ fontSize: "11px", fontWeight: 600, padding: "4px 12px",
                      borderRadius: "999px",
                      border: `1px solid ${p.ok ? M : "#334155"}28`,
                      background: p.ok ? `${M}10` : "rgba(255,255,255,0.03)",
                      color: p.ok ? M : "#475569" }}>
                      {p.ok ? "✓ " : ""}{p.label}
                    </span>
                  ))}
                </div>

                <button onClick={() => setStep("intent")} className="pri-btn" style={primaryBtn}>
                  Swap Privately →
                </button>
                <p style={{ fontSize: "12px", color: "#334155", marginTop: "10px", textAlign: "center" }}>
                  Any chain · No bridge · Encrypted intent
                </p>
              </div>
            )}

            {/* ── Intent ── */}
            {step === "intent" && (
              <div style={{ ...card, animation: "rise 0.4s ease both", maxWidth: "540px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                  <h2 style={{ fontSize: "20px", fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.4px" }}>
                    Swap Privately
                  </h2>
              {connected && phantomPubkey && (
                <div style={{ fontSize: "11px", color: M, background: `${M}12`,
                  border: `1px solid ${M}25`, borderRadius: "8px", padding: "4px 10px",
                  display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ width: "5px", height: "5px", borderRadius: "50%",
                    background: M, display: "inline-block" }} />
                  {addrFmt(phantomPubkey)}
                </div>
              )}
            </div>

            {/* ── Token selector (Uniswap-style) ── */}
            <div style={{ marginBottom: "16px" }}>

              {/* You pay */}
              <div style={{ background: "rgba(255,255,255,0.04)", border: "1.5px solid rgba(255,255,255,0.09)",
                borderRadius: "18px", padding: "16px 18px", marginBottom: "4px" }}>
                <div style={{ fontSize: "11px", color: "#475569", marginBottom: "10px", fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: "0.8px" }}>You pay</div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <input
                    type="number" min="0" step="any"
                    value={fromAmount}
                    onChange={e => setFromAmount(e.target.value)}
                    placeholder="0"
                    style={{ flex: 1, background: "transparent", border: "none", outline: "none",
                      fontSize: "30px", fontWeight: 800, color: "#f1f5f9", width: "0",
                      fontFamily: "inherit", letterSpacing: "-0.5px" }}
                  />
                  {/* From token button + dropdown */}
                  <div ref={fromPickerRef} style={{ position: "relative", flexShrink: 0 }}>
                    <button onClick={() => { setShowFromPicker(v => !v); setShowToPicker(false); }}
                      style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer",
                        background: "rgba(255,255,255,0.09)", border: "1.5px solid rgba(255,255,255,0.13)",
                        borderRadius: "999px", padding: "7px 12px 7px 7px" }}>
                      <span style={{ width: "28px", height: "28px", borderRadius: "50%", background: fromToken.color,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "13px", fontWeight: 900, color: "#fff" }}>{fromToken.letter}</span>
                      <span style={{ fontWeight: 800, fontSize: "15px", color: "#f1f5f9" }}>{fromToken.symbol}</span>
                      <span style={{ fontSize: "9px", color: "#64748b" }}>▼</span>
                    </button>
                    {showFromPicker && (
                      <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 200,
                        background: "#141629", border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: "14px", padding: "8px", minWidth: "210px",
                        boxShadow: "0 24px 60px rgba(0,0,0,0.7)" }}>
                        {TOKENS.filter(t => !(t.symbol === toToken.symbol && t.chain === toToken.chain)).map(t => (
                          <button key={`${t.symbol}-${t.chain}`}
                            onClick={() => { setFromToken(t); setFromChain(t.chain); setShowFromPicker(false); setNlText(""); }}
                            style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%",
                              padding: "9px 12px", borderRadius: "9px", border: "none", cursor: "pointer",
                              background: t.symbol === fromToken.symbol && t.chain === fromToken.chain ? `${P}18` : "transparent",
                              color: t.symbol === fromToken.symbol && t.chain === fromToken.chain ? "#c4b5fd" : "#94a3b8", textAlign: "left" }}>
                            <span style={{ width: "30px", height: "30px", borderRadius: "50%", background: t.color,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: "13px", fontWeight: 900, color: "#fff", flexShrink: 0 }}>{t.letter}</span>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: "14px" }}>{t.symbol}</div>
                              <div style={{ fontSize: "11px", color: "#475569" }}>{t.name} · {t.network}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: "12px", color: "#334155", marginTop: "8px", display: "flex", justifyContent: "space-between" }}>
                  <span>{fromAmount ? `≈ $${(parseFloat(fromAmount) * getPrice(fromToken.symbol)).toFixed(2)}` : "$0.00"}</span>
                  <span style={{ color: "#475569", fontSize: "11px" }}>{fromToken.network}</span>
                </div>
              </div>

              {/* Swap direction button */}
              <div style={{ display: "flex", justifyContent: "center", margin: "-1px 0", position: "relative", zIndex: 10 }}>
                <button
                  onClick={() => { const tmp = fromToken; setFromToken(toToken); setToToken(tmp);
                    setFromChain(toToken.symbol); setToChain(tmp.symbol); setFromAmount(""); setNlText(""); }}
                  style={{ width: "36px", height: "36px", borderRadius: "10px",
                    background: "#111220", border: "2px solid rgba(255,255,255,0.1)",
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#64748b", fontSize: "18px", transition: "all 0.2s" }}>
                  ↕
                </button>
              </div>

              {/* You receive */}
              <div style={{ background: "rgba(255,255,255,0.025)", border: "1.5px solid rgba(255,255,255,0.06)",
                borderRadius: "18px", padding: "16px 18px", marginTop: "4px" }}>
                <div style={{ fontSize: "11px", color: "#475569", marginBottom: "10px", fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: "0.8px" }}>You receive (est.)</div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ flex: 1, fontSize: "30px", fontWeight: 800, letterSpacing: "-0.5px",
                    color: toAmountEst ? M : "#334155" }}>
                    {toAmountEst || "0"}
                  </div>
                  {/* To token button + dropdown */}
                  <div ref={toPickerRef} style={{ position: "relative", flexShrink: 0 }}>
                    <button onClick={() => { setShowToPicker(v => !v); setShowFromPicker(false); }}
                      style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer",
                        background: "rgba(255,255,255,0.09)", border: "1.5px solid rgba(255,255,255,0.13)",
                        borderRadius: "999px", padding: "7px 12px 7px 7px" }}>
                      <span style={{ width: "28px", height: "28px", borderRadius: "50%", background: toToken.color,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "13px", fontWeight: 900, color: "#fff" }}>{toToken.letter}</span>
                      <span style={{ fontWeight: 800, fontSize: "15px", color: "#f1f5f9" }}>{toToken.symbol}</span>
                      <span style={{ fontSize: "9px", color: "#64748b" }}>▼</span>
                    </button>
                    {showToPicker && (
                      <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 200,
                        background: "#141629", border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: "14px", padding: "8px", minWidth: "210px",
                        boxShadow: "0 24px 60px rgba(0,0,0,0.7)" }}>
                        {TOKENS.filter(t => !(t.symbol === fromToken.symbol && t.chain === fromToken.chain)).map(t => (
                          <button key={`${t.symbol}-${t.chain}`}
                            onClick={() => { setToToken(t); setToChain(t.chain); setShowToPicker(false); setNlText(""); }}
                            style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%",
                              padding: "9px 12px", borderRadius: "9px", border: "none", cursor: "pointer",
                              background: t.symbol === toToken.symbol && t.chain === toToken.chain ? `${P}18` : "transparent",
                              color: t.symbol === toToken.symbol && t.chain === toToken.chain ? "#c4b5fd" : "#94a3b8", textAlign: "left" }}>
                            <span style={{ width: "30px", height: "30px", borderRadius: "50%", background: t.color,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: "13px", fontWeight: 900, color: "#fff", flexShrink: 0 }}>{t.letter}</span>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: "14px" }}>{t.symbol}</div>
                              <div style={{ fontSize: "11px", color: "#475569" }}>{t.name} · {t.network}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: "12px", color: "#334155", marginTop: "8px", display: "flex", justifyContent: "space-between" }}>
                  <span>{toAmountEst ? `≈ $${(parseFloat(toAmountEst) * getPrice(toToken.symbol)).toFixed(2)}` : "$0.00"}</span>
                  <span style={{ color: "#475569", fontSize: "11px" }}>{toToken.network}</span>
                </div>
              </div>

              {/* Rate estimate row */}
              {fromAmount && toAmountEst && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 4px", fontSize: "11px", color: "#475569" }}>
                  <span>1 {fromToken.symbol} ≈ {(getRate(fromToken.symbol, toToken.symbol)).toFixed(6)} {toToken.symbol}</span>
                  <span style={{ color: M, fontWeight: 600 }}>0.5% fee</span>
                </div>
              )}
            </div>


            {/* NL textarea — optional AI override */}
            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontSize: "11px", color: "#475569", marginBottom: "8px", fontWeight: 600,
                display: "flex", alignItems: "center", gap: "6px" }}>
                <span>🤖</span> Or describe with AI (optional)
              </div>
              <textarea
                value={nlText}
                onChange={e => setNlText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && !submitting && !nlParsing && !accepting && (e.preventDefault(), handleSmartSubmit())}
                placeholder={`e.g. "cheapest fee" or "fastest route for ${fromToken.symbol} → ${toToken.symbol}"`}
                rows={2}
                className="pi-input"
                style={{ ...inp, fontSize: "14px", lineHeight: 1.65, resize: "none",
                  padding: "12px 16px", transition: "border-color 0.2s, box-shadow 0.2s" }}
              />
              <div style={{ fontSize: "11px", color: "#334155", marginTop: "6px" }}>
                AI parses your preference · Enter to submit
              </div>
            </div>

            {/* ── Timed-Release Escrow — Coming Soon ── */}
            <div style={{ background: "rgba(255,255,255,0.018)", border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "14px", padding: "12px 16px", marginBottom: "16px", opacity: 0.6, cursor: "not-allowed" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ filter: "grayscale(1)" }}>⏱️</span>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#475569" }}>Timed-Release Escrow</span>
                </div>
                <span style={{ fontSize: "9px", fontWeight: 800, letterSpacing: "0.8px", textTransform: "uppercase",
                  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                  color: "#64748b", borderRadius: "20px", padding: "3px 9px" }}>Coming Soon</span>
              </div>
              <div style={{ fontSize: "10px", color: "#334155", marginTop: "6px", lineHeight: 1.5 }}>
                Lock swap execution to a future datetime — intent sealed on Encrypt FHE until release.
              </div>
            </div>

            {/* CTA */}
            <button onClick={handleSmartSubmit} disabled={submitting || nlParsing || accepting}
              className="pri-btn hide-on-mobile" style={{ ...primaryBtn, fontSize: "17px", padding: "17px 28px" }}>
              {nlParsing ? (
                <>
                  <span style={{ width: "16px", height: "16px", border: "2px solid rgba(255,255,255,0.4)",
                    borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite",
                    display: "inline-block" }} />
                  AI parsing intent…
                </>
              ) : accepting ? (
                <>
                  <span style={{ width: "16px", height: "16px", border: "2px solid rgba(255,255,255,0.4)",
                    borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite",
                    display: "inline-block" }} />
                  Locking escrow in Phantom…
                </>
              ) : submitting ? (
                <>
                  <span style={{ width: "16px", height: "16px", border: "2px solid rgba(255,255,255,0.4)",
                    borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite",
                    display: "inline-block" }} />
                  Finding best solver…
                </>
              ) : "Swap Privately →"}
            </button>

            {/* Trust badges row */}
            <div style={{ display: "flex", gap: "8px", marginTop: "16px", flexWrap: "wrap" }}>
              {[
                { label: "✓ FHE encrypted on-chain", color: M },
                { label: "✓ Blind auction", color: P },
                { label: "✓ Anchor escrow locked", color: "#0ea5e9" },
              ].map(t => (
                <span key={t.label} style={{ fontSize: "10px", fontWeight: 600, color: t.color,
                  background: `${t.color}12`, border: `1px solid ${t.color}28`,
                  borderRadius: "999px", padding: "3px 10px" }}>{t.label}</span>
              ))}
            </div>
          </div>
        )}

        {/* ── Tracking ── */}
        {step === "tracking" && trackingStatus && (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

            {/* Status header */}
            <div style={{ ...card, animation: "rise 0.35s ease both" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <h2 style={{ fontSize: "20px", fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.4px" }}>
                  Transaction Tracking
                </h2>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  {chip("ERC-7683", "#6366f1")}
                  <StatusBadge status={trackingStatus.status} />
                </div>
              </div>

              {/* Timed-release countdown */}
              {intentResult?.releaseAfter && (
                <TimeLockCountdown releaseAt={intentResult.releaseAfter as string} />
              )}

              {trackingStatus.viewingKeyGranted && (
                <div style={{ background: "#6366f110", border: "1px solid #6366f130",
                  borderRadius: "12px", padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <span>🔑</span>
                    <span style={{ fontSize: "11px", color: "#a78bfa", fontWeight: 700 }}>VIEWING KEY GRANTED</span>
                    {chip("RESOLVED ORDER", "#6366f1")}
                  </div>
                  <p style={{ fontSize: "12px", color: "#64748b", margin: 0, lineHeight: 1.6 }}>
                    Winning solver received your encrypted intent viewing key via ResolvedOrder (ERC-7683).
                    They will decrypt, validate, then execute delivery via Ika MPC.
                  </p>
                </div>
              )}
            </div>

            {/* Delivery timeline */}
            <div style={{ ...card, animation: "rise 0.4s 0.05s ease both" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#475569", letterSpacing: "1px",
                textTransform: "uppercase", marginBottom: "20px" }}>Delivery Pipeline</div>
              <TrackingTimeline trackingStatus={trackingStatus} intentResult={intentResult} />
            </div>

            {/* Intent details */}
            <div style={{ ...card, animation: "rise 0.4s 0.1s ease both" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#475569", letterSpacing: "1px",
                textTransform: "uppercase", marginBottom: "14px" }}>Intent Details</div>
              {(() => {
                const rawTxId = trackingStatus.deliveryTxId ?? "";
                const pipeIdx = rawTxId.indexOf("|");
                const txId = pipeIdx > -1 ? rawTxId.slice(0, pipeIdx) : rawTxId;
                const explorerUrl = pipeIdx > -1 ? rawTxId.slice(pipeIdx + 1) : "";
                const isLive = !!explorerUrl && !txId.startsWith("sim_");
                const encHash = intentResult?.encryptedIntentHash ?? "";
                const encRow = encHash ? (
                  <div key="encrypted-hash" style={{ display: "flex", justifyContent: "space-between",
                    padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)",
                    fontSize: "12px", alignItems: "center" }}>
                    <span style={{ color: "#475569", fontWeight: 500 }}>Encrypted Hash</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ color: "#64748b", fontFamily: "'Space Mono', monospace", fontSize: "11px" }}>
                        {encHash.slice(0,18)}…
                      </span>
                      <button onClick={() => {
                        navigator.clipboard.writeText(encHash).catch(() => {});
                        setCopiedHash(true);
                        setTimeout(() => setCopiedHash(false), 1800);
                      }} style={{ fontSize: "10px", fontWeight: 700,
                        color: copiedHash ? M : P, cursor: "pointer",
                        background: copiedHash ? `${M}12` : `${P}10`,
                        border: `1px solid ${copiedHash ? M : P}28`,
                        borderRadius: "5px", padding: "2px 8px", transition: "all 0.2s",
                      }}>
                        {copiedHash ? "✓ Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                ) : null;
                const mainRows = [
                  { label: "Intent ID",       val: `#${intentResult?.intentId}`,                         link: null as string|null, live: false },
                  { label: "Escrow Lock TX",  val: trackingStatus.sourceTxId ? `${trackingStatus.sourceTxId.slice(0,18)}…` : "—", link: trackingStatus.sourceTxExplorer ?? (trackingStatus.sourceTxId ? `https://explorer.solana.com/tx/${trackingStatus.sourceTxId}?cluster=devnet` : null), live: !!trackingStatus.sourceTxId && !String(trackingStatus.sourceTxId ?? "").startsWith("sim_") },
                  { label: "Escrow PDA",      val: trackingStatus.escrowPda ? `${trackingStatus.escrowPda.slice(0,18)}…` : "—", link: trackingStatus.escrowPda ? `https://explorer.solana.com/address/${trackingStatus.escrowPda}?cluster=devnet` : null, live: false },
                  { label: "Delivery TX",     val: txId ? `${txId.slice(0,18)}…` : "Pending",            link: explorerUrl || null as string|null, live: isLive },
                  { label: "Proof Hash",      val: trackingStatus.proofHash ? `${trackingStatus.proofHash.slice(0,18)}…` : "Pending", link: null as string|null, live: false },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between",
                    padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)",
                    fontSize: "12px", alignItems: "center" }}>
                    <span style={{ color: "#475569", fontWeight: 500 }}>{row.label}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      {row.live && (
                        <span style={{ fontSize: "9px", fontWeight: 800, color: M,
                          background: `${M}18`, border: `1px solid ${M}30`, borderRadius: "4px", padding: "1px 6px" }}>LIVE TX</span>
                      )}
                      {row.link ? (
                        <a href={row.link} target="_blank" rel="noreferrer"
                          style={{ color: M, fontFamily: "'Space Mono', monospace", textDecoration: "none",
                            fontSize: "11px", fontWeight: 600 }}>
                          {row.val} ↗
                        </a>
                      ) : (
                        <span style={{ color: "#64748b", fontFamily: "'Space Mono', monospace", fontSize: "11px" }}>
                          {row.val}
                        </span>
                      )}
                    </div>
                  </div>
                ));
                return [encRow, ...mainRows];
              })()}
            </div>

            {/* Bids summary */}
            {intentResult?.bids && intentResult.bids.length > 0 && (
              <div style={{ ...card, animation: "rise 0.4s 0.15s ease both" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#475569", letterSpacing: "1px",
                  textTransform: "uppercase", marginBottom: "16px" }}>Solver Auction</div>
                <SolverRace bids={intentResult.bids} winner={selectedSolver} />
              </div>
            )}

            {/* ── Privacy Proof ── */}
            {intentResult && (
              <div style={{ ...card, animation: "rise 0.4s 0.18s ease both" }}>
                <button onClick={() => setShowPrivacyProof(v => !v)}
                  style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer",
                    display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "18px" }}>🔐</span>
                    <div style={{ textAlign: "left" }}>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#f1f5f9" }}>Privacy Proof</div>
                      <div style={{ fontSize: "10px", color: "#475569", marginTop: "1px" }}>
                        FHE encryption · Ika DKG · ERC-7683 order
                      </div>
                    </div>
                    {chip("VERIFIABLE", M)}
                  </div>
                  <span style={{ fontSize: "18px", color: "#475569",
                    transform: showPrivacyProof ? "rotate(180deg)" : "none",
                    transition: "transform 0.2s", display: "inline-block" }}>⌄</span>
                </button>

                {showPrivacyProof && (
                  <div style={{ marginTop: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>

                    {/* FHE Encrypted Intent ID */}
                    <div>
                      <div style={{ fontSize: "10px", fontWeight: 700, color: "#475569", letterSpacing: "1px",
                        textTransform: "uppercase", marginBottom: "8px" }}>FHE Encrypted Intent ID</div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px",
                        background: `${P}0d`, border: `1px solid ${P}28`,
                        borderRadius: "10px", padding: "10px 14px" }}>
                        <span style={{ fontSize: "14px" }}>🔒</span>
                        <span style={{ flex: 1, fontFamily: "'Space Mono', monospace", fontSize: "11px",
                          color: "#c4b5fd", wordBreak: "break-all" }}>
                          {intentResult.encryptedIntentId.slice(0, 24)}…{intentResult.encryptedIntentId.slice(-8)}
                        </span>
                        <button onClick={() => {
                          navigator.clipboard.writeText(intentResult.encryptedIntentId).catch(() => {});
                          setCopiedEncId(true);
                          setTimeout(() => setCopiedEncId(false), 1800);
                        }} style={{ fontSize: "10px", fontWeight: 700,
                          color: copiedEncId ? M : P, cursor: "pointer",
                          background: copiedEncId ? `${M}12` : `${P}10`,
                          border: `1px solid ${copiedEncId ? M : P}28`,
                          borderRadius: "5px", padding: "2px 8px", transition: "all 0.2s", flexShrink: 0 }}>
                          {copiedEncId ? "✓ Copied" : "Copy"}
                        </button>
                      </div>
                    </div>

                    {/* Hex barcode visual of encrypted hash */}
                    {intentResult.encryptedIntentHash && (
                      <div>
                        <div style={{ fontSize: "10px", fontWeight: 700, color: "#475569", letterSpacing: "1px",
                          textTransform: "uppercase", marginBottom: "8px" }}>Encrypted Hash — Barcode Visual</div>
                        <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.07)",
                          borderRadius: "10px", padding: "12px 14px" }}>
                          <div style={{ display: "flex", gap: "2px", flexWrap: "wrap", marginBottom: "8px" }}>
                            {intentResult.encryptedIntentHash.split("").map((c, i) => {
                              const v = parseInt(c, 16) / 15;
                              const hue = (i * 19) % 360;
                              return (
                                <div key={i} style={{
                                  width: "8px", height: `${12 + Math.round(v * 20)}px`,
                                  background: `hsl(${hue},70%,${40 + Math.round(v * 30)}%)`,
                                  borderRadius: "2px", flexShrink: 0,
                                }} />
                              );
                            })}
                          </div>
                          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px",
                            color: "#334155", wordBreak: "break-all", lineHeight: 1.5 }}>
                            {intentResult.encryptedIntentHash}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ERC-7683 CrossChainOrder fields */}
                    {intentResult.crossChainOrder && (
                      <div>
                        <div style={{ fontSize: "10px", fontWeight: 700, color: "#475569", letterSpacing: "1px",
                          textTransform: "uppercase", marginBottom: "8px" }}>
                          ERC-7683 CrossChainOrder
                          {chip("STANDARD", "#6366f1")}
                        </div>
                        <div style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.15)",
                          borderRadius: "10px", overflow: "hidden" }}>
                          {(() => {
                            const cco = intentResult.crossChainOrder;
                            const fillDeadline = cco?.fillDeadline;
                            return [
                              { label: "Standard",        val: cco?.standard ?? "ERC-7683-Inspired" },
                              { label: "Order Type",      val: cco?.orderDataType ?? "PrivateSwapOrder" },
                              { label: "Origin Chain",    val: cco?.originChainId ?? "solana-devnet" },
                              { label: "Destination",     val: cco?.destinationChainId ?? "—" },
                              { label: "Input Token",     val: cco?.inputToken ?? "—" },
                              { label: "Input Amount",    val: cco?.inputAmount ?? "SEALED" },
                              { label: "Output Token",    val: cco?.outputToken ?? "—" },
                              { label: "Fill Deadline",   val: fillDeadline ? new Date(fillDeadline).toLocaleString() : "—" },
                            ];
                          })().map(row => (
                            <div key={row.label} style={{ display: "flex", justifyContent: "space-between",
                              padding: "7px 14px", borderBottom: "1px solid rgba(99,102,241,0.08)",
                              fontSize: "11px", alignItems: "flex-start", gap: "8px" }}>
                              <span style={{ color: "#475569", fontWeight: 600, flexShrink: 0 }}>{row.label}</span>
                              <span style={{ color: row.val.startsWith("SEALED") ? P : "#94a3b8",
                                fontFamily: "'Space Mono', monospace", fontSize: "10px",
                                textAlign: "right", wordBreak: "break-all",
                                fontStyle: row.val.startsWith("SEALED") ? "italic" : "normal" }}>
                                {row.val}
                              </span>
                            </div>
                          ))}
                          <div style={{ padding: "8px 14px", fontSize: "10px", color: "#334155",
                            fontStyle: "italic", lineHeight: 1.5 }}>
                            {intentResult.crossChainOrder?.privacyNote ?? ""}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Solver blind bid summary */}
                    {(() => {
                      const winningBid = intentResult.bids?.find((b: SolverBid) => b.solverId === (trackingStatus.winningSolverId ?? selectedSolver))
                        ?? intentResult.bestBid;
                      if (!winningBid) return null;
                      return (
                        <div>
                          <div style={{ fontSize: "10px", fontWeight: 700, color: "#475569", letterSpacing: "1px",
                            textTransform: "uppercase", marginBottom: "8px" }}>Ika DKG — Solver Blind Bid</div>
                          <div style={{ background: `${M}08`, border: `1px solid ${M}20`,
                            borderRadius: "10px", padding: "12px 14px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                              marginBottom: "10px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <span style={{ fontSize: "14px" }}>🤝</span>
                                <span style={{ fontSize: "12px", fontWeight: 700, color: "#f1f5f9" }}>
                                  {winningBid.solverName}
                                </span>
                                {chip("WINNER", M)}
                              </div>
                              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "13px",
                                fontWeight: 800, color: M }}>
                                {parseFloat(winningBid.outputAmount).toFixed(6)}
                                <span style={{ fontSize: "11px", color: "#64748b", marginLeft: "4px" }}>{winningBid.toToken}</span>
                              </div>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                              {[
                                { label: "Bid Fee",       val: `${winningBid.feePercent}% (${winningBid.feeAmount} ${winningBid.fromToken})` },
                                { label: "Est. Time",     val: `~${winningBid.estimatedSeconds}s` },
                                { label: "Reputation",    val: `${winningBid.reputationScore}/100` },
                                { label: "Bid Strategy",  val: winningBid.solverStrategy ?? "standard" },
                              ].map(r => (
                                <div key={r.label} style={{ background: "rgba(0,0,0,0.2)", borderRadius: "7px",
                                  padding: "6px 10px" }}>
                                  <div style={{ fontSize: "9px", color: "#475569", fontWeight: 700,
                                    textTransform: "uppercase", letterSpacing: "0.5px" }}>{r.label}</div>
                                  <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px",
                                    fontFamily: "'Space Mono', monospace" }}>{r.val}</div>
                                </div>
                              ))}
                            </div>
                            <div style={{ marginTop: "10px", fontSize: "10px", color: "#334155",
                              fontStyle: "italic", lineHeight: 1.5 }}>
                              Solver bid BLIND — saw only route and encrypted hash, never your wallet address or input amount.
                              Ika DKG distributed key generation signs the delivery without any single party knowing the full key.
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Stealth destination address highlight */}
                    {(trackingStatus.destinationAddress || srAddress) && (
                      <div>
                        <div style={{ fontSize: "10px", fontWeight: 700, color: "#475569", letterSpacing: "1px",
                          textTransform: "uppercase", marginBottom: "8px" }}>Stealth Destination Address</div>
                        <div style={{ background: `${P}0e`, border: `1.5px solid ${P}40`,
                          borderRadius: "10px", padding: "12px 14px",
                          display: "flex", alignItems: "center", gap: "10px" }}>
                          <span style={{ fontSize: "16px" }}>👻</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "10px",
                              color: "#c4b5fd", wordBreak: "break-all", lineHeight: 1.6 }}>
                              {trackingStatus.destinationAddress || srAddress}
                            </div>
                            <div style={{ fontSize: "9px", color: "#475569", marginTop: "4px" }}>
                              One-time stealth address — unlinked from your main wallet identity
                            </div>
                          </div>
                          {chip("STEALTH", P)}
                        </div>
                      </div>
                    )}

                    {/* Verify on Explorer button */}
                    {(() => {
                      const rawTxId = trackingStatus.deliveryTxId ?? "";
                      const pipeIdx = rawTxId.indexOf("|");
                      const txId = pipeIdx > -1 ? rawTxId.slice(0, pipeIdx) : rawTxId;
                      const explorerUrl = pipeIdx > -1 ? rawTxId.slice(pipeIdx + 1) : "";
                      const solanaDevnetUrl = txId && !txId.startsWith("sim_")
                        ? (explorerUrl || `https://explorer.solana.com/tx/${txId}?cluster=devnet`)
                        : null;
                      return (
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          {solanaDevnetUrl ? (
                            <a href={solanaDevnetUrl} target="_blank" rel="noreferrer"
                              style={{ display: "inline-flex", alignItems: "center", gap: "6px",
                                background: `${M}14`, border: `1px solid ${M}35`,
                                color: M, fontWeight: 700, fontSize: "12px",
                                padding: "8px 16px", borderRadius: "8px", textDecoration: "none",
                                transition: "background 0.2s" }}>
                              <span>🔍</span> Verify Delivery TX on Explorer ↗
                            </a>
                          ) : (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px",
                              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                              color: "#475569", fontWeight: 600, fontSize: "12px",
                              padding: "8px 16px", borderRadius: "8px" }}>
                              <span>⏳</span> Explorer link available after delivery
                            </span>
                          )}
                          {trackingStatus.escrowPda && (
                            <a href={`https://explorer.solana.com/address/${trackingStatus.escrowPda}?cluster=devnet`}
                              target="_blank" rel="noreferrer"
                              style={{ display: "inline-flex", alignItems: "center", gap: "6px",
                                background: `${P}10`, border: `1px solid ${P}28`,
                                color: "#a78bfa", fontWeight: 700, fontSize: "12px",
                                padding: "8px 16px", borderRadius: "8px", textDecoration: "none" }}>
                              <span>🔐</span> Verify Escrow PDA ↗
                            </a>
                          )}
                        </div>
                      );
                    })()}

                  </div>
                )}
              </div>
            )}

            {/* Settled banner */}
            {trackingStatus.status === "settled" && (
              <div style={{ background: `${M}0e`, border: `1px solid ${M}35`,
                borderRadius: "16px", padding: "24px", textAlign: "center",
                animation: "rise 0.5s ease both" }}>
                <div style={{ fontSize: "36px", marginBottom: "10px" }}>🎉</div>
                <div style={{ fontWeight: 800, fontSize: "18px", color: M, marginBottom: "6px" }}>Intent Settled!</div>
                <div style={{ fontSize: "13px", color: "#64748b" }}>Native tokens delivered. Escrow released to solver.</div>
              </div>
            )}

            {/* Dispute */}
            {["settled","delivered","failed"].includes(trackingStatus.status) && (
              <div style={{ ...card, background: "rgba(239,68,68,0.03)",
                border: "1px solid rgba(239,68,68,0.14)", animation: "rise 0.4s 0.2s ease both" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "16px" }}>⚖️</span>
                    <span style={{ fontWeight: 700, fontSize: "14px" }}>AI Dispute Resolution</span>
                    {chip("CLAUDE JUDGE", "#ef4444")}
                  </div>
                  <button onClick={() => setShowDispute(!showDispute)} style={{
                    background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
                    color: "#fca5a5", fontSize: "12px", fontWeight: 600, padding: "4px 12px",
                    borderRadius: "7px", cursor: "pointer",
                  }}>{showDispute ? "Hide" : "File Dispute"}</button>
                </div>
                <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
                  Didn't receive your tokens? Claude AI evaluates your dispute and gives a binding verdict.
                </p>
                {showDispute && (
                  <div style={{ marginTop: "16px" }}>
                    <textarea value={disputeClaim} onChange={e => setDisputeClaim(e.target.value)}
                      placeholder="Describe the issue — e.g. 'I did not receive my ETH. The delivery TX is not on explorer.'"
                      className="pi-input"
                      style={{ ...inp, minHeight: "80px", resize: "vertical" }} />
                    <button onClick={handleDispute} disabled={disputing || !disputeClaim.trim()}
                      className="pri-btn" style={{ ...primaryBtn, marginTop: "10px", fontSize: "14px",
                        background: "linear-gradient(135deg, #dc2626, #991b1b)" }}>
                      {disputing ? "🤖 AI Judge evaluating…" : "Submit to AI Judge →"}
                    </button>
                    {disputeResult && (
                      <div style={{ marginTop: "14px",
                        background: `${verdictColor[disputeResult.verdict] ?? "#64748b"}10`,
                        border: `1px solid ${verdictColor[disputeResult.verdict] ?? "#64748b"}28`,
                        borderRadius: "12px", padding: "16px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                          <span style={{ fontWeight: 800, fontSize: "16px", textTransform: "uppercase",
                            color: verdictColor[disputeResult.verdict] ?? "#f1f5f9" }}>
                            Verdict: {disputeResult.verdict}
                          </span>
                          <span style={{ fontSize: "12px", color: "#64748b" }}>
                            {Math.round(disputeResult.confidence * 100)}% confidence
                          </span>
                        </div>
                        <p style={{ fontSize: "13px", color: "#94a3b8", marginBottom: "8px" }}>{disputeResult.reasoning}</p>
                        <p style={{ fontSize: "12px", color: "#475569", fontStyle: "italic", marginBottom: "10px" }}>{disputeResult.recommendation}</p>
                        <div style={{ fontSize: "11px", color: "#334155" }}>
                          {disputeResult.evidence.map((e, i) => <div key={i} style={{ padding: "2px 0" }}>• {e}</div>)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {["settled","failed"].includes(trackingStatus.status) && (
              <button onClick={resetApp} className="pri-btn" style={primaryBtn}>New Swap →</button>
            )}
          </div>
        )}

            {/* ── Dark Pool Page ── */}
            {step === "darkpool" && (
              <div style={{ animation: "rise 0.35s ease both", maxWidth: "760px" }}>
                {/* Header */}
                <div style={{ marginBottom: "18px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.5px", marginBottom: "4px" }}>Dark Pool</h1>
                    <p style={{ fontSize: "12px", color: "#475569" }}>P2P sealed order matching — wallet, amount & side hidden by Encrypt FHE</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {chip("MEV-SHIELDED", P)}
                    {chip("P2P", M)}
                    <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: M, boxShadow: `0 0 6px ${M}`, animation: "pulse 1.5s infinite" }} />
                  </div>
                </div>

                {/* Match result banner */}
                {dpLastResult && (
                  <div style={{ background: dpLastResult.matched ? `${M}12` : `${P}0e`, border: `1px solid ${dpLastResult.matched ? M + "40" : P + "30"}`, borderRadius: "12px", padding: "14px 18px", marginBottom: "16px", display: "flex", alignItems: "flex-start", gap: "12px" }}>
                    <span style={{ fontSize: "20px", lineHeight: 1 }}>{dpLastResult.matched ? "✅" : "🌑"}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "13px", color: dpLastResult.matched ? M : "#c4b5fd", fontWeight: 700, marginBottom: "4px" }}>
                        {dpLastResult.matched ? "Order Matched!" : "Order Sealed"}
                      </div>
                      <div style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.5 }}>{dpLastResult.message}</div>
                      <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", color: "#475569", marginTop: "6px" }}>
                        FHE ID: <span style={{ color: "#7c3aed" }}>{dpLastResult.encHash}</span>
                      </div>
                    </div>
                    <button onClick={() => setDpLastResult(null)} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: "16px", padding: "0 4px" }}>×</button>
                  </div>
                )}

                {/* Tabs */}
                <div style={{ display: "flex", gap: "4px", marginBottom: "16px", background: "rgba(255,255,255,0.03)", borderRadius: "10px", padding: "4px" }}>
                  {(["book","place"] as const).map(t => (
                    <button key={t} onClick={() => setDpTab(t)} style={{ flex: 1, padding: "8px", borderRadius: "7px", border: "none", cursor: "pointer", fontSize: "12px", fontWeight: 700, transition: "all 0.2s", background: dpTab === t ? (t === "place" ? P : "rgba(255,255,255,0.08)") : "transparent", color: dpTab === t ? (t === "place" ? "#fff" : "#f1f5f9") : "#475569" }}>
                      {t === "book" ? `Order Book (${darkPoolData.length})` : "Place Order"}
                    </button>
                  ))}
                </div>

                {/* ── Order Book tab ── */}
                {dpTab === "book" && (
                  <>
                    <div style={{ ...card, padding: 0, overflow: "hidden", marginBottom: "14px" }}>
                      <div style={{ padding: "11px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "11px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "1px" }}>Live Sealed Orders</span>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          {darkPoolLoading && <span style={{ width: "11px", height: "11px", border: `1.5px solid ${P}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", display: "inline-block" }} />}
                          <span style={{ fontSize: "10px", color: "#334155" }}>Auto-refresh 5s</span>
                        </div>
                      </div>
                      {/* Column header */}
                      <div style={{ display: "grid", gridTemplateColumns: "2.2fr 1.4fr 0.9fr 1.1fr", padding: "7px 18px", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: "10px", color: "#334155", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        <span>Sealed FHE ID</span><span>Route</span><span>Size</span><span>Status</span>
                      </div>
                      {darkPoolData.length === 0 && !darkPoolLoading ? (
                        <div style={{ padding: "52px", textAlign: "center", color: "#334155", fontSize: "13px" }}>
                          <div style={{ fontSize: "40px", marginBottom: "12px", opacity: 0.2 }}>🌑</div>
                          <div>No open orders in pool</div>
                          <div style={{ fontSize: "11px", marginTop: "6px", color: "#1e293b" }}>Place an order to find a counterparty</div>
                        </div>
                      ) : darkPoolData.map((item: any, i: number) => {
                        const dots = item.sizeDots ?? 1;
                        return (
                          <div key={i} style={{ display: "grid", gridTemplateColumns: "2.2fr 1.4fr 0.9fr 1.1fr", padding: "11px 18px", alignItems: "center", borderBottom: i < darkPoolData.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none", background: i % 2 === 0 ? `${P}04` : "transparent" }}>
                            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", color: "#7c3aed", letterSpacing: "0.5px" }} title={item.encHash}>{item.encHash}</div>
                            <div style={{ fontSize: "12px", fontWeight: 700, color: "#38bdf8" }}>{item.route}</div>
                            <div style={{ display: "flex", gap: "3px", alignItems: "center" }}>
                              {[0,1,2].map(d => <span key={d} style={{ width: "7px", height: "7px", borderRadius: "50%", background: d < dots ? P : "rgba(255,255,255,0.06)" }} />)}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: M, boxShadow: `0 0 4px ${M}`, flexShrink: 0, display: "inline-block", animation: "pulse 1.5s infinite" }} />
                              <span style={{ fontSize: "10px", color: M, fontWeight: 700 }}>OPEN</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* My orders section */}
                    {dpMyOrders.length > 0 && (
                      <div style={{ ...card, padding: 0, overflow: "hidden", marginBottom: "14px" }}>
                        <div style={{ padding: "11px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                          <span style={{ fontSize: "11px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "1px" }}>My Orders</span>
                        </div>
                        {dpMyOrders.map((o: any, i: number) => {
                          const statusColors: Record<string, string> = { open: M, matched: "#0ea5e9", cancelled: "#475569" };
                          const sc = statusColors[o.status] ?? "#64748b";
                          return (
                            <div key={o.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 18px", borderBottom: i < dpMyOrders.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                              <div style={{ display: "flex", gap: "14px", alignItems: "center", flex: 1 }}>
                                <span style={{ fontSize: "11px", fontWeight: 800, padding: "2px 8px", borderRadius: "5px", background: o.side === "buy" ? `${M}18` : `${P}18`, color: o.side === "buy" ? M : "#c4b5fd" }}>{o.side.toUpperCase()}</span>
                                <span style={{ fontSize: "12px", fontWeight: 700, color: "#38bdf8" }}>{o.route}</span>
                                <span style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", color: "#475569" }}>{o.amount} {o.tokenIn}</span>
                                {o.priceLimit && <span style={{ fontSize: "10px", color: "#334155" }}>≤ {o.priceLimit}</span>}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                {o.matchId && (
                                  <span style={{ fontSize: "10px", color: "#0ea5e9", fontFamily: "'Space Mono',monospace" }} title={`Matched with: ${o.matchEncHash}`}>⚡ matched</span>
                                )}
                                <span style={{ fontSize: "10px", fontWeight: 700, color: sc, textTransform: "uppercase" }}>{o.status}</span>
                                {o.status === "open" && (
                                  <button onClick={() => handleCancelDarkPoolOrder(o.id)} style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "5px", color: "#f87171", cursor: "pointer", fontSize: "10px", padding: "2px 8px" }}>Cancel</button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {chip("Amount: SEALED", "#ef4444")}
                      {chip("Wallet: SEALED", "#ef4444")}
                      {chip("Side: SEALED", "#ef4444")}
                      {chip("Route: visible", M)}
                    </div>
                  </>
                )}

                {/* ── Place Order tab ── */}
                {dpTab === "place" && (
                  <div style={{ ...card, maxWidth: "480px" }}>
                    <div style={{ marginBottom: "18px" }}>
                      <div style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.6 }}>
                        <span style={{ color: "#c4b5fd", fontWeight: 700 }}>Sealed by Encrypt FHE.</span>{" "}
                        Your wallet, amount, and side are invisible to counterparties. Only the route is revealed for matching.
                      </div>
                    </div>

                    {/* Buy / Sell toggle */}
                    <div style={{ marginBottom: "16px" }}>
                      <label style={{ fontSize: "11px", color: "#475569", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "6px" }}>Side</label>
                      <div style={{ display: "flex", gap: "6px" }}>
                        {(["sell","buy"] as const).map(s => (
                          <button key={s} onClick={() => setDpSide(s)} style={{ flex: 1, padding: "10px", borderRadius: "8px", border: `1.5px solid ${dpSide === s ? (s === "buy" ? M : P) : "rgba(255,255,255,0.08)"}`, cursor: "pointer", background: dpSide === s ? (s === "buy" ? `${M}18` : `${P}18`) : "rgba(255,255,255,0.03)", color: dpSide === s ? (s === "buy" ? M : "#c4b5fd") : "#475569", fontWeight: 800, fontSize: "13px", transition: "all 0.2s" }}>
                            {s === "sell" ? "SELL / OFFER" : "BUY / BID"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Token pair */}
                    <div style={{ marginBottom: "14px" }}>
                      <label style={{ fontSize: "11px", color: "#475569", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "6px" }}>
                        {dpSide === "sell" ? "You Offer → You Want" : "You Want → You Pay with"}
                      </label>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <select value={dpTokenIn} onChange={e => setDpTokenIn(e.target.value)} style={{ flex: 1, background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#f1f5f9", padding: "10px 12px", fontSize: "13px", fontWeight: 700, cursor: "pointer", outline: "none" }}>
                          <option>SOL</option><option>ETH</option><option>PYUSD</option>
                        </select>
                        <span style={{ color: "#475569", fontSize: "18px", fontWeight: 900 }}>→</span>
                        <select value={dpTokenOut} onChange={e => setDpTokenOut(e.target.value)} style={{ flex: 1, background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#f1f5f9", padding: "10px 12px", fontSize: "13px", fontWeight: 700, cursor: "pointer", outline: "none" }}>
                          <option>ETH</option><option>SOL</option><option>PYUSD</option>
                        </select>
                      </div>
                    </div>

                    {/* Amount */}
                    <div style={{ marginBottom: "14px" }}>
                      <label style={{ fontSize: "11px", color: "#475569", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "6px" }}>Amount ({dpTokenIn}) — sealed</label>
                      <input type="number" min="0" step="any" value={dpAmount} onChange={e => setDpAmount(e.target.value)} placeholder="e.g. 1.5" style={{ width: "100%", boxSizing: "border-box", background: "#0f172a", border: `1.5px solid ${dpAmount ? P + "50" : "rgba(255,255,255,0.08)"}`, borderRadius: "8px", color: "#f1f5f9", padding: "10px 14px", fontSize: "14px", fontFamily: "'Space Mono',monospace", outline: "none" }} />
                    </div>

                    {/* Price limit (optional) */}
                    <div style={{ marginBottom: "20px" }}>
                      <label style={{ fontSize: "11px", color: "#475569", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "6px" }}>
                        Price Limit ({dpTokenOut}/{dpTokenIn}) — optional, sealed
                      </label>
                      <input type="number" min="0" step="any" value={dpPrice} onChange={e => setDpPrice(e.target.value)} placeholder="Leave blank = market order" style={{ width: "100%", boxSizing: "border-box", background: "#0f172a", border: "1.5px solid rgba(255,255,255,0.08)", borderRadius: "8px", color: "#94a3b8", padding: "10px 14px", fontSize: "13px", fontFamily: "'Space Mono',monospace", outline: "none" }} />
                    </div>

                    {/* Privacy notice */}
                    <div style={{ background: `${P}0a`, border: `1px solid ${P}20`, borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", fontSize: "11px", color: "#64748b", lineHeight: 1.6 }}>
                      🔒 <strong style={{ color: "#c4b5fd" }}>FHE-sealed:</strong> wallet address, amount, price limit, and side are encrypted. Counterparty only sees route ({dpTokenIn}→{dpTokenOut}).
                    </div>

                    <button onClick={handlePlaceDarkPoolOrder} disabled={dpSubmitting || !dpAmount || !dpTokenIn || !dpTokenOut} style={{ width: "100%", padding: "13px", borderRadius: "10px", border: "none", cursor: dpSubmitting || !dpAmount ? "not-allowed" : "pointer", background: dpSubmitting || !dpAmount ? "rgba(255,255,255,0.05)" : `linear-gradient(135deg,${P},#6d28d9)`, color: dpSubmitting || !dpAmount ? "#334155" : "#fff", fontWeight: 800, fontSize: "14px", letterSpacing: "-0.2px", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                      {dpSubmitting ? (
                        <><span style={{ width: "14px", height: "14px", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite", display: "inline-block" }} /> Sealing & Placing Order…</>
                      ) : (
                        <>🌑 Place Sealed {dpSide === "buy" ? "Bid" : "Offer"}</>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── Vault Page ── */}
            {step === "vault" && (
              <div style={{ animation: "rise 0.35s ease both", maxWidth: "560px" }}>
                <div style={{ marginBottom: "20px" }}>
                  <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.5px", marginBottom: "4px" }}>Shielded Vault</h1>
                  <p style={{ fontSize: "12px", color: "#475569" }}>Private balance layer — obfuscated from on-chain explorer</p>
                </div>
                {/* balance card */}
                <div style={{ ...card, marginBottom: "14px", background: "linear-gradient(135deg,rgba(15,23,42,0.9),rgba(124,58,237,0.12))", border: `1px solid ${P}28` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                    <span style={{ fontSize: "10px", color: "#64748b", textTransform: "uppercase", letterSpacing: "1px" }}>Shielded Balance</span>
                    <button onClick={() => setVaultRevealed(v => !v)} style={{ background: vaultRevealed ? `${M}15` : "rgba(255,255,255,0.06)", border: `1px solid ${vaultRevealed ? M + "30" : "rgba(255,255,255,0.1)"}`, borderRadius: "7px", padding: "4px 12px", cursor: "pointer", fontSize: "10px", fontWeight: 700, color: vaultRevealed ? M : "#475569" }}>
                      {vaultRevealed ? "🔓 Revealed" : "🔒 Reveal"}
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: "32px", marginBottom: "14px" }}>
                    {(["SOL","ETH"] as const).map(t => (
                      <div key={t}>
                        <div style={{ fontSize: "28px", fontWeight: 900, fontFamily: "'Space Mono',monospace", letterSpacing: "-1px", color: vaultRevealed ? (t === "SOL" ? "#9945ff" : "#627eea") : "#334155" }}>
                          {vaultRevealed ? (vaultBalance[t] || 0).toFixed(4) : "••••"}
                        </div>
                        <div style={{ fontSize: "11px", color: "#475569", marginTop: "2px" }}>
                          {t} · {t === "SOL" ? "Devnet" : "Sepolia"}
                          {vaultRevealed && vaultBalance[t] > 0 && (
                            <span style={{ color: "#334155", marginLeft: "4px" }}>≈ ${(vaultBalance[t] * getPrice(t)).toFixed(2)}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {chip("🛡 Balance obfuscated", P)}
                    {chip("✓ History encrypted", M)}
                  </div>
                </div>
                {/* token selector */}
                <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
                  {(["SOL","ETH"] as const).map(t => (
                    <button key={t} onClick={() => setVaultToken(t)} style={{ flex: 1, padding: "9px", borderRadius: "10px", cursor: "pointer", background: vaultToken === t ? `${P}20` : "rgba(255,255,255,0.04)", color: vaultToken === t ? "#c4b5fd" : "#475569", fontWeight: vaultToken === t ? 700 : 400, fontSize: "13px", border: `1px solid ${vaultToken === t ? P + "40" : "rgba(255,255,255,0.07)"}`, transition: "all 0.15s" }}>{t}</button>
                  ))}
                </div>
                {/* deposit / withdraw */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
                  <div style={{ ...card }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: P, marginBottom: "10px", display: "flex", alignItems: "center", gap: "6px" }}><span>⬇</span> Deposit</div>
                    <input type="number" min="0" step="any" value={vaultDepositAmt} onChange={e => setVaultDepositAmt(e.target.value)} placeholder={`0.00 ${vaultToken}`} className="pi-input" style={{ ...inp, fontSize: "14px", marginBottom: "10px" }} />
                    <button onClick={handleVaultDeposit} disabled={vaultDepositing || !vaultDepositAmt} className="pri-btn" style={{ ...primaryBtn, fontSize: "13px", padding: "10px", width: "100%" }}>
                      {vaultDepositing ? "Shielding…" : "Shield Assets"}
                    </button>
                  </div>
                  <div style={{ ...card }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: M, marginBottom: "10px", display: "flex", alignItems: "center", gap: "6px" }}><span>⬆</span> Withdraw</div>
                    <input type="number" min="0" step="any" value={vaultWithdrawAmt} onChange={e => setVaultWithdrawAmt(e.target.value)} placeholder={`0.00 ${vaultToken}`} className="pi-input" style={{ ...inp, fontSize: "14px", marginBottom: "10px" }} />
                    <button onClick={handleVaultWithdraw} disabled={vaultWithdrawing || !vaultWithdrawAmt} className="pri-btn" style={{ ...primaryBtn, fontSize: "13px", padding: "10px", width: "100%", background: `linear-gradient(135deg,${M},#0ea5e9)` }}>
                      {vaultWithdrawing ? "Unshielding…" : "To Stealth Addr"}
                    </button>
                  </div>
                </div>
                {/* ── Withdraw → Private Drop circuit ── */}
                {vaultWithdrawData && (() => {
                  const steps = [
                    {
                      key: "generated",
                      label: "Stealth Address Generated",
                      desc: vaultWithdrawData.chain === "ETH" ? "secp256k1 one-time keypair" : "Ed25519 one-time keypair",
                      icon: "🔑",
                      done: true,
                      active: false,
                    },
                    {
                      key: "queued",
                      label: "Dark Pool Mixing",
                      desc: vaultWithdrawDpPhase === "queued"
                        ? `~${vaultWithdrawData.darkPool.remainingMin.toFixed(1)} min delay — timing correlation prevented`
                        : "Mixing complete",
                      icon: "🌑",
                      done: vaultWithdrawDpPhase === "processing" || vaultWithdrawDpPhase === "delivered",
                      active: vaultWithdrawDpPhase === "queued",
                    },
                    {
                      key: "delivered",
                      label: "Solver Delivery",
                      desc: vaultWithdrawDpPhase === "delivered" && vaultWithdrawDelivered
                        ? `${parseFloat(vaultWithdrawDelivered.outputAmount ?? "0").toFixed(6)} ${vaultWithdrawData.chain} delivered`
                        : "Blind auction → solver pool → main wallet",
                      icon: "📦",
                      done: vaultWithdrawDpPhase === "delivered",
                      active: vaultWithdrawDpPhase === "processing",
                    },
                  ];
                  return (
                    <div style={{ background: `${M}07`, border: `1px solid ${M}22`, borderRadius: "14px", padding: "16px 18px", marginBottom: "16px", animation: "rise 0.3s ease both" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span>🫧</span>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: M }}>PRIVATE DROP CIRCUIT</span>
                          {chip("4-hop privacy", M)}
                        </div>
                        {vaultWithdrawPolling && (
                          <div style={{ width: "12px", height: "12px", border: `2px solid ${M}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                        )}
                      </div>
                      {/* stealth address */}
                      <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: "8px", padding: "8px 12px", marginBottom: "8px" }}>
                        <div style={{ fontSize: "9px", color: "#475569", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "3px" }}>
                          {vaultWithdrawData.chain} One-time Stealth Address
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", color: "#94a3b8", wordBreak: "break-all", flex: 1 }}>{vaultWithdrawData.stealthAddress}</div>
                          <button onClick={() => navigator.clipboard.writeText(vaultWithdrawData.stealthAddress)} style={{ flexShrink: 0, fontSize: "9px", color: M, background: `${M}15`, border: `1px solid ${M}25`, borderRadius: "4px", padding: "2px 8px", cursor: "pointer" }}>Copy</button>
                        </div>
                        <div style={{ fontSize: "9px", color: "#334155", marginTop: "3px" }}>{vaultWithdrawData.keySource?.split("(")[0]?.trim()}</div>
                      </div>
                      {/* monitor key */}
                      <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: "8px", padding: "8px 12px", marginBottom: "12px" }}>
                        <div style={{ fontSize: "9px", color: "#475569", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "3px" }}>
                          Monitor Key <span style={{ color: "#ef4444", fontWeight: 400 }}>— keep secret</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", color: "#64748b", wordBreak: "break-all", flex: 1 }}>
                            {vaultWithdrawData.monitorKey.slice(0, 16)}…{vaultWithdrawData.monitorKey.slice(-8)}
                          </div>
                          <button onClick={() => navigator.clipboard.writeText(vaultWithdrawData.monitorKey)} style={{ flexShrink: 0, fontSize: "9px", color: P, background: `${P}15`, border: `1px solid ${P}25`, borderRadius: "4px", padding: "2px 8px", cursor: "pointer" }}>Copy</button>
                        </div>
                        <div style={{ fontSize: "9px", color: "#334155", marginTop: "3px" }}>Required to poll delivery status — not stored server-side after session</div>
                      </div>
                      {/* 3-step progress */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
                        {steps.map((s, i) => (
                          <div key={s.key} style={{ display: "flex", gap: "12px", alignItems: "flex-start", paddingBottom: i < steps.length - 1 ? "16px" : "0", position: "relative" }}>
                            {i < steps.length - 1 && (
                              <div style={{ position: "absolute", left: "13px", top: "28px", width: "2px", bottom: "0",
                                background: s.done ? `linear-gradient(to bottom,${M},${P})` : "rgba(255,255,255,0.07)" }} />
                            )}
                            <div style={{
                              width: "28px", height: "28px", flexShrink: 0, borderRadius: "50%", zIndex: 1,
                              background: s.done ? `linear-gradient(135deg,${M},${P})` : s.active ? `${P}22` : "rgba(255,255,255,0.06)",
                              border: s.active ? `2px solid ${P}` : s.done ? "none" : "1.5px solid rgba(255,255,255,0.1)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              boxShadow: s.active ? `0 0 0 4px ${P}18` : s.done ? `0 0 8px ${M}30` : "none",
                            }}>
                              {s.done ? (
                                <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                                  <path d="M2.5 7l3 3 6-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              ) : s.active ? (
                                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: P, animation: "pulse 1.2s infinite" }} />
                              ) : (
                                <span style={{ fontSize: "11px" }}>{s.icon}</span>
                              )}
                            </div>
                            <div style={{ paddingTop: "3px" }}>
                              <div style={{ fontSize: "12px", fontWeight: 600, color: s.done ? "#f1f5f9" : s.active ? "#c4b5fd" : "#475569" }}>{s.label}</div>
                              <div style={{ fontSize: "10px", color: "#334155", marginTop: "1px" }}>{s.desc}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                      {/* delivered summary */}
                      {vaultWithdrawDpPhase === "delivered" && vaultWithdrawDelivered && (
                        <div style={{ marginTop: "12px", background: `${M}12`, border: `1px solid ${M}30`, borderRadius: "8px", padding: "8px 12px" }}>
                          <div style={{ fontSize: "11px", fontWeight: 700, color: M, marginBottom: "4px" }}>Solver delivered — no on-chain link to vault</div>
                          {vaultWithdrawDelivered.solver && (
                            <div style={{ fontSize: "10px", color: "#64748b" }}>Solver: {vaultWithdrawDelivered.solver.name} · {vaultWithdrawDelivered.feePercent}% fee</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
                {/* history */}
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "10px" }}>Vault History</div>
                {vaultLoading ? (
                  <div style={{ textAlign: "center", padding: "24px", color: "#334155" }}>
                    <div style={{ width: "20px", height: "20px", border: `2px solid ${P}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 8px" }} />Loading…
                  </div>
                ) : vaultHistory.length === 0 ? (
                  <div style={{ padding: "32px", textAlign: "center", color: "#334155", fontSize: "12px", background: "rgba(255,255,255,0.025)", borderRadius: "12px" }}>
                    <div style={{ fontSize: "32px", marginBottom: "8px", opacity: 0.3 }}>🔒</div>No vault activity yet
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {vaultHistory.map((h: any, i: number) => (
                      <div key={i} style={{ background: "rgba(255,255,255,0.025)", border: `1px solid ${h.type === "deposit" ? P + "18" : M + "18"}`, borderRadius: "10px", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span style={{ fontSize: "16px" }}>{h.type === "deposit" ? "⬇" : "⬆"}</span>
                          <div>
                            <div style={{ fontSize: "12px", fontWeight: 700, color: h.type === "deposit" ? "#c4b5fd" : M }}>{h.type === "deposit" ? "Shielded" : "Unshielded to stealth"}</div>
                            <div style={{ fontSize: "10px", color: "#334155" }}>{new Date(h.ts).toLocaleString()}</div>
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: "13px", fontWeight: 700, fontFamily: "'Space Mono',monospace", color: h.type === "deposit" ? "#c4b5fd" : M }}>{(h.amount as number).toFixed(4)} {h.token}</div>
                          {h.stealthAddress && <div style={{ fontSize: "9px", color: "#334155", fontFamily: "'Space Mono',monospace" }}>→ {(h.stealthAddress as string).slice(0, 10)}…</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}


            {/* ── Private Drop ── */}
            {step === "stealth" && (() => {
              const tabChainColor = srTabChain === "ETH" ? "#627EEA" : "#9945FF";
              const tabChainLabel = srTabChain === "ETH" ? "ETH Sepolia" : "SOL Devnet";
              const tabTokenSym   = srTabChain === "ETH" ? "ETH" : "SOL";
              const tabKeyType    = srTabChain === "ETH" ? "secp256k1" : "Ed25519";
              return (
                <div style={{ animation: "rise 0.35s ease both", maxWidth: "560px" }}>
                  {/* Header */}
                  <div style={{ marginBottom: "20px" }}>
                    <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.5px", marginBottom: "4px" }}>🫧 Private Drop</h1>
                    <p style={{ fontSize: "12px", color: "#475569" }}>3-hop privacy: stealth address → Dark Pool → solver → main wallet</p>
                  </div>

                  {/* Chain selector */}
                  <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                    {(["SOL", "ETH"] as const).map(c => (
                      <button key={c} onClick={() => { setSrTabChain(c); if (srAddress && srChain !== c) { setSrAddress(""); setSrMonitorKey(""); setSrBalance(null); setSrForwardResult(null); } }}
                        style={{ flex: 1, padding: "9px", borderRadius: "10px", cursor: "pointer",
                          background: srTabChain === c ? (c === "ETH" ? "#627EEA18" : "#9945FF18") : "rgba(255,255,255,0.04)",
                          color: srTabChain === c ? (c === "ETH" ? "#627EEA" : "#9945FF") : "#475569",
                          fontWeight: srTabChain === c ? 700 : 400, fontSize: "13px",
                          border: `1px solid ${srTabChain === c ? (c === "ETH" ? "#627EEA40" : "#9945FF40") : "rgba(255,255,255,0.07)"}`,
                          transition: "all 0.15s" }}>
                        {c === "SOL" ? "SOL Devnet" : "ETH Sepolia"}
                      </button>
                    ))}
                  </div>

                  {/* Privacy info card */}
                  <div style={{ background: `${P}06`, border: `1px solid ${P}18`, borderRadius: "12px", padding: "12px 14px", marginBottom: "16px" }}>
                    <div style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.65 }}>
                      <span style={{ color: "#c4b5fd", fontWeight: 700 }}>3-hop privacy:</span>{" "}
                      Anyone sends {tabTokenSym} to your stealth address → funds enter <strong style={{ color: "#7c3aed" }}>Dark Pool</strong> (2–5 min random mixing delay) → solver delivers to your main wallet from <em>their own pool</em> → no direct on-chain link exists.
                    </div>
                    <div style={{ display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap" }}>
                      {chip("Ika MPC signed", P)}
                      {chip("Encrypt FHE sealed", "#0ea5e9")}
                      {chip("Dark Pool mixing", "#7c3aed")}
                      {chip("Gas sponsored", M)}
                    </div>
                  </div>

                  {/* ── Dark Pool queue + delivery progress panel ── */}
                  {(srQueueResult || srStatusPhase !== "idle") && !srDelivered && (
                    <div style={{ background: `${P}08`, border: `1px solid ${P}22`, borderRadius: "14px", padding: "16px 18px", marginBottom: "16px", animation: "rise 0.3s ease both" }}>
                      <div style={{ marginBottom: "14px" }}>
                        <div style={{ fontSize: "12px", fontWeight: 800, color: "#c4b5fd", marginBottom: "10px" }}>Privacy Routing Progress</div>
                        {/* Step indicators */}
                        {[
                          { label: "Entered Dark Pool", desc: "Mixing with other transactions", done: srStatusPhase === "queued" || srStatusPhase === "processing" || srStatusPhase === "delivered", active: srStatusPhase === "queued" },
                          { label: "Solver selected", desc: "Blind auction — best route chosen", done: srStatusPhase === "processing" || srStatusPhase === "delivered", active: srStatusPhase === "processing" },
                          { label: "Privately delivered", desc: "Funds arrive in your main wallet", done: srStatusPhase === "delivered", active: false },
                        ].map((s, i) => (
                          <div key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start", marginBottom: "10px" }}>
                            <div style={{ width: "20px", height: "20px", borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                              background: s.done ? M : s.active ? `${P}50` : "rgba(255,255,255,0.06)",
                              border: `2px solid ${s.done ? M : s.active ? P : "rgba(255,255,255,0.12)"}`,
                              fontSize: "10px", color: s.done ? "#0a0b14" : s.active ? "#c4b5fd" : "#334155" }}>
                              {s.done ? "✓" : i + 1}
                            </div>
                            <div>
                              <div style={{ fontSize: "11px", fontWeight: 700, color: s.done ? M : s.active ? "#c4b5fd" : "#334155" }}>{s.label}</div>
                              <div style={{ fontSize: "10px", color: "#475569" }}>{s.desc}</div>
                              {s.active && srStatusPhase === "queued" && srQueueResult && (
                                <div style={{ fontSize: "10px", color: P, fontWeight: 700, marginTop: "3px" }}>
                                  {srQueueResult.remainingMs > 0
                                    ? `⏳ ~${Math.ceil(srQueueResult.remainingMs / 1000)}s remaining`
                                    : "⏳ Processing…"}
                                </div>
                              )}
                              {s.active && srStatusPhase === "processing" && (
                                <div style={{ fontSize: "10px", color: P, fontWeight: 700, marginTop: "3px" }}>🔄 Routing via solver…</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      {srQueueResult && (
                        <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: "8px", padding: "8px 10px" }}>
                          <div style={{ fontSize: "9px", color: "#334155" }}>Amount: <span style={{ color: "#e2e8f0", fontFamily: "'Space Mono',monospace" }}>{srQueueResult.amount} {srQueueResult.chain}</span></div>
                          <div style={{ fontSize: "9px", color: "#334155", marginTop: "2px" }}>Release at: <span style={{ color: "#e2e8f0" }}>{new Date(srQueueResult.releaseAt).toLocaleTimeString()}</span></div>
                          <div style={{ fontSize: "9px", color: "#334155", marginTop: "2px" }}>{srQueueResult.darkPoolNote}</div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Delivered result ── */}
                  {srDelivered && (
                    <div style={{ background: `${M}09`, border: `1px solid ${M}28`, borderRadius: "14px", padding: "16px 18px", marginBottom: "16px", animation: "rise 0.3s ease both" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                        <span style={{ fontSize: "18px" }}>✅</span>
                        <span style={{ fontWeight: 800, color: M, fontSize: "14px" }}>Privately Delivered</span>
                        {chip(`Intent #${srDelivered.intentId}`, M)}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
                        {[
                          ["Output", `${srDelivered.outputAmount} ${tabTokenSym}`],
                          ["Fee", `${srDelivered.feePercent}%`],
                          ["Solver", srDelivered.solver?.name],
                          ["ETA", `~${srDelivered.solver?.estimatedSeconds}s`],
                        ].map(([k, v]) => (
                          <div key={k} style={{ background: "rgba(255,255,255,0.03)", borderRadius: "8px", padding: "8px 10px" }}>
                            <div style={{ fontSize: "9px", color: "#475569", marginBottom: "2px" }}>{k}</div>
                            <div style={{ fontSize: "11px", fontWeight: 700, color: "#e2e8f0", fontFamily: "'Space Mono',monospace" }}>{v}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ background: "rgba(0,0,0,0.25)", borderRadius: "10px", padding: "10px 12px", marginBottom: "10px" }}>
                        <div style={{ fontSize: "9px", color: P, fontWeight: 700, marginBottom: "6px" }}>Privacy proof — on-chain trace (3 hops)</div>
                        {srDelivered.privacyProof?.onChainTrace?.map((t: string, i: number) => (
                          <div key={i} style={{ fontSize: "9px", color: "#475569", fontFamily: "'Space Mono',monospace", lineHeight: "1.7", display: "flex", gap: "5px" }}>
                            <span style={{ color: P, flexShrink: 0 }}>{i + 1}.</span>{t}
                          </div>
                        ))}
                        {srDelivered.note && (
                          <div style={{ marginTop: "5px", fontSize: "9px", fontWeight: 700, color: M }}>{srDelivered.note}</div>
                        )}
                      </div>
                      <button onClick={() => { setSrDelivered(null); setSrQueueResult(null); setSrStatusPhase("idle"); setSrAddress(""); setSrMonitorKey(""); setSrBalance(null); setSrForwardResult(null); }}
                        style={{ width: "100%", padding: "9px", borderRadius: "9px", border: `1px solid ${P}25`, background: `${P}10`, color: "#c4b5fd", fontWeight: 700, fontSize: "12px", cursor: "pointer" }}>
                        Generate New Address
                      </button>
                    </div>
                  )}

                  {/* Generate / address panel */}
                  {!srForwardResult && !srQueueResult && !srDelivered && (
                    <div style={{ ...card }}>
                      {!srAddress || srChain !== srTabChain ? (
                        <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
                          <div style={{ fontSize: "36px", marginBottom: "10px", opacity: 0.5 }}>🕵️</div>
                          <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "18px", lineHeight: 1.6 }}>
                            Generate a one-time <strong style={{ color: tabChainColor }}>{tabChainLabel}</strong> stealth address.<br />
                            <span style={{ fontSize: "11px" }}>{tabKeyType} keypair · expires in 24 hours</span>
                          </div>
                          <button onClick={handleGenerateStealthTab} disabled={srGenerating || !phantomPubkey}
                            style={{ width: "100%", padding: "13px", borderRadius: "11px", border: "none",
                              cursor: phantomPubkey && !srGenerating ? "pointer" : "not-allowed",
                              background: phantomPubkey ? `linear-gradient(135deg,${P},${P}bb)` : "rgba(255,255,255,0.05)",
                              color: phantomPubkey ? "white" : "#334155", fontWeight: 800, fontSize: "14px",
                              boxShadow: phantomPubkey ? `0 4px 20px ${P}40` : "none" }}>
                            {srGenerating ? `Generating ${tabKeyType} keypair…` : phantomPubkey ? `+ Generate ${tabChainLabel} Stealth Address` : "Connect wallet first"}
                          </button>
                        </div>
                      ) : (
                        <>
                          {/* Address display */}
                          <div style={{ background: "rgba(255,255,255,0.035)", border: `1px solid ${tabChainColor}25`, borderRadius: "12px", padding: "14px 16px", marginBottom: "12px" }}>
                            <div style={{ fontSize: "9px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: "6px" }}>
                              Your Stealth Address · {tabChainLabel} · {tabKeyType}
                            </div>
                            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "11px", color: tabChainColor, wordBreak: "break-all", lineHeight: "1.65", marginBottom: "8px" }}>{srAddress}</div>
                            <div style={{ fontSize: "10px", color: "#334155", marginBottom: "10px" }}>
                              Share as CEX withdrawal target, swap output, or with anyone sending {tabTokenSym}. Server auto-sponsors gas on forward.
                            </div>
                            <div style={{ display: "flex", gap: "8px" }}>
                              <button onClick={() => { navigator.clipboard.writeText(srAddress); setSrCopied(true); setTimeout(() => setSrCopied(false), 2000); }}
                                style={{ flex: 1, padding: "8px", borderRadius: "8px", border: `1px solid ${srCopied ? M + "40" : "rgba(255,255,255,0.1)"}`, background: srCopied ? `${M}12` : "rgba(255,255,255,0.05)", color: srCopied ? M : "#94a3b8", fontWeight: 700, fontSize: "11px", cursor: "pointer" }}>
                                {srCopied ? "✓ Copied!" : `📋 Copy Address`}
                              </button>
                              <button onClick={handleGenerateStealthTab} disabled={srGenerating}
                                style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "#64748b", fontWeight: 700, fontSize: "11px", cursor: "pointer" }}>
                                ↺ New
                              </button>
                            </div>
                          </div>

                          {/* Live balance monitor */}
                          <div style={{ background: srBalance?.hasIncoming ? `${M}09` : "rgba(255,255,255,0.025)", border: `1px solid ${srBalance?.hasIncoming ? M + "28" : "rgba(255,255,255,0.07)"}`, borderRadius: "12px", padding: "14px 16px", marginBottom: "12px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div>
                                <div style={{ fontSize: "9px", color: "#475569", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                  {tabChainLabel} Balance {srPolling ? "🔄" : "·"} polling 5s
                                </div>
                                <div style={{ fontSize: "26px", fontWeight: 900, fontFamily: "'Space Mono',monospace", color: srBalance?.hasIncoming ? M : "#334155", lineHeight: 1.1 }}>
                                  {srBalance ? srBalance.balance.toFixed(6) : "—"} <span style={{ fontSize: "13px", color: tabChainColor }}>{tabTokenSym}</span>
                                </div>
                                {srBalance?.balanceUsd !== undefined && (
                                  <div style={{ fontSize: "11px", color: "#475569", marginTop: "2px" }}>≈ ${srBalance.balanceUsd.toFixed(2)} USD</div>
                                )}
                              </div>
                              {srBalance?.hasIncoming
                                ? <div style={{ textAlign: "center" }}>
                                    <div style={{ fontSize: "20px", marginBottom: "2px" }}>💰</div>
                                    <span style={{ fontSize: "9px", fontWeight: 700, color: M, background: `${M}20`, border: `1px solid ${M}40`, borderRadius: "20px", padding: "3px 10px" }}>Received</span>
                                  </div>
                                : <div style={{ textAlign: "center" }}>
                                    <div style={{ fontSize: "18px", marginBottom: "2px", opacity: 0.3 }}>⏳</div>
                                    <span style={{ fontSize: "9px", color: "#334155", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "20px", padding: "3px 10px" }}>Waiting…</span>
                                  </div>
                              }
                            </div>
                          </div>

                          {/* Forward / sweep button */}
                          <button onClick={handleForwardStealthTab} disabled={!srBalance?.hasIncoming || srForwarding}
                            style={{ width: "100%", padding: "14px", borderRadius: "12px", border: "none",
                              cursor: srBalance?.hasIncoming && !srForwarding ? "pointer" : "not-allowed",
                              background: srBalance?.hasIncoming ? `linear-gradient(135deg,${P},${M})` : "rgba(255,255,255,0.05)",
                              color: srBalance?.hasIncoming ? "white" : "#334155",
                              fontWeight: 800, fontSize: "14px",
                              boxShadow: srBalance?.hasIncoming ? `0 4px 20px ${P}45` : "none",
                              marginBottom: "8px" }}>
                            {srForwarding
                              ? "🔄 Entering Dark Pool…"
                              : srBalance?.hasIncoming
                                ? `🫧 Drop ${srBalance.balance.toFixed(4)} ${tabTokenSym} → Dark Pool → Main Wallet`
                                : `Waiting for ${tabTokenSym} to arrive on stealth address…`}
                          </button>
                          <div style={{ fontSize: "10px", color: "#334155", textAlign: "center" }}>
                            3 hops: stealth → dark pool → solver → main wallet · gas sponsored
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}


            {/* Mobile bottom bar — app steps */}
            <div className="mobile-bottom-bar">
              {step === "dashboard" && (
                <button onClick={() => setStep("intent")} className="pri-btn" style={primaryBtn}>Swap Privately →</button>
              )}
              {step === "intent" && (
                <button onClick={handleSmartSubmit} disabled={submitting || nlParsing || accepting}
                  className="pri-btn" style={primaryBtn}>
                  {nlParsing ? "AI parsing…" : accepting ? "Locking escrow…" : submitting ? "Finding solver…" : "Swap Privately →"}
                </button>
              )}
              {step === "stealth" && srBalance?.hasIncoming && !srQueueResult && !srDelivered && (
                <button onClick={handleForwardStealthTab} disabled={srForwarding} className="pri-btn" style={primaryBtn}>
                  {srForwarding ? "Entering Dark Pool…" : `🫧 Drop ${srBalance.balance.toFixed(4)} ${srTabChain} →`}
                </button>
              )}
              {step === "tracking" && trackingStatus && ["settled","failed"].includes(trackingStatus.status) && (
                <button onClick={resetApp} className="pri-btn" style={primaryBtn}>New Swap →</button>
              )}
            </div>
          </div>
        </div>
      )} {/* end sidebar layout */}

      {/* ── Intent History Modal ── */}
      {showHistory && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000,
          display: "flex", alignItems: "flex-start", justifyContent: "center",
          overflowY: "auto", padding: "32px 16px" }}
          onClick={e => { if (e.target === e.currentTarget) setShowHistory(false); }}>
          <div style={{ background: "#0d0e1a", border: `1px solid rgba(14,165,233,0.22)`,
            borderRadius: "22px", width: "100%", maxWidth: "680px", padding: "28px", color: "#e2e8f0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "20px" }}>🔒</span>
                <span style={{ fontSize: "20px", fontWeight: 800 }}>Intent History</span>
                {chip("PRIVACY-PRESERVED", "#0ea5e9")}
              </div>
              <button onClick={() => setShowHistory(false)} style={{
                background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                color: "#64748b", fontSize: "18px", width: "36px", height: "36px",
                borderRadius: "9px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              }}>✕</button>
            </div>
            <div style={{ background: "rgba(14,165,233,0.06)", border: "1px solid rgba(14,165,233,0.14)",
              borderRadius: "12px", padding: "12px 16px", marginBottom: "20px",
              fontSize: "12px", color: "#64748b", lineHeight: 1.65 }}>
              <span style={{ color: "#38bdf8", fontWeight: 700 }}>Privacy mode active.</span>{" "}
              Wallet address, destination, and input amount are sealed by{" "}
              <span style={{ color: "#c4b5fd", fontWeight: 600 }}>Encrypt FHE</span> — unreadable to anyone.
            </div>
            <div style={{ display: "flex", gap: "6px", marginBottom: "20px", flexWrap: "wrap" }}>
              {["Wallet", "Destination", "Amount"].map(f => (
                <div key={f} style={{ display: "flex", alignItems: "center", gap: "4px",
                  background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.16)",
                  borderRadius: "6px", padding: "3px 10px", fontSize: "11px", color: "#94a3b8" }}>
                  <span style={{ fontSize: "9px" }}>🚫</span>
                  <span style={{ textDecoration: "line-through", opacity: 0.55 }}>{f}</span>
                </div>
              ))}
              {["Route","Output","Solver","Status"].map(f => (
                <div key={f} style={{ display: "flex", alignItems: "center", gap: "4px",
                  background: `${M}07`, border: `1px solid ${M}18`,
                  borderRadius: "6px", padding: "3px 10px", fontSize: "11px", color: "#64748b" }}>
                  <span style={{ fontSize: "9px", color: M }}>✓</span>{f}
                </div>
              ))}
            </div>
            {loadingHistory ? (
              <div style={{ textAlign: "center", padding: "40px", color: "#475569" }}>
                <div style={{ width: "24px", height: "24px", border: `2px solid #0ea5e9`,
                  borderTopColor: "transparent", borderRadius: "50%",
                  animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
                Loading…
              </div>
            ) : historyData.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px", color: "#334155", fontSize: "13px" }}>
                <div style={{ fontSize: "36px", marginBottom: "12px", opacity: 0.4 }}>🔒</div>
                No intents yet.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {historyData.map((item, i) => {
                  const sc: Record<string,string> = {
                    settled: M, delivered: "#0ea5e9", executing: "#f59e0b",
                    accepted: P, bidding: "#f59e0b", failed: "#ef4444",
                    refunded: "#94a3b8", pending: "#475569",
                  };
                  const c = sc[item.status] ?? "#64748b";
                  const isReal = item.deliveryTxId && !item.deliveryTxId.startsWith("sim_");
                  const ts = item.createdAt ? new Date(item.createdAt).toLocaleString() : "—";
                  return (
                    <div key={i} style={{ background: "rgba(255,255,255,0.025)",
                      border: "1px solid rgba(255,255,255,0.07)",
                      borderRadius: "12px", padding: "14px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: "11px", color: "#334155",
                              background: "rgba(255,255,255,0.04)", padding: "1px 7px", borderRadius: "4px" }}>
                              #{item.anonymousId}
                            </span>
                            <span style={{ fontSize: "13px", fontWeight: 700, color: "#38bdf8" }}>{item.route}</span>
                          </div>
                          <div style={{ fontSize: "11px", color: "#475569" }}>
                            Solver: <span style={{ color: "#94a3b8", fontWeight: 600 }}>{item.winningSolverName || "—"}</span>
                          </div>
                          <div style={{ fontSize: "10px", color: "#334155" }}>{ts}</div>
                        </div>
                        <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: "4px" }}>
                          {item.outputAmount ? (
                            <div style={{ fontSize: "15px", fontWeight: 800, fontFamily: "'Space Mono', monospace",
                              color: item.status === "settled" ? M : "#f1f5f9" }}>
                              {parseFloat(item.outputAmount).toFixed(6)} {item.toToken}
                            </div>
                          ) : (
                            <div style={{ fontSize: "12px", color: "#334155" }}>amount sealed</div>
                          )}
                          <div style={{ display: "flex", alignItems: "center", gap: "5px", justifyContent: "flex-end" }}>
                            <span style={{ width: "6px", height: "6px", borderRadius: "50%",
                              background: c, boxShadow: `0 0 5px ${c}`, display: "inline-block" }} />
                            <span style={{ fontSize: "11px", color: c, fontWeight: 700, textTransform: "capitalize" }}>{item.status}</span>
                          </div>
                          {isReal && item.deliveryExplorerUrl && (
                            <a href={item.deliveryExplorerUrl} target="_blank" rel="noreferrer" style={{
                              fontSize: "10px", color: M, textDecoration: "none", fontWeight: 600,
                              background: `${M}0f`, border: `1px solid ${M}25`,
                              borderRadius: "4px", padding: "2px 7px",
                            }}>On-chain ↗</a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ marginTop: "18px", fontSize: "11px", color: "#1e293b", textAlign: "center" }}>
              Up to 50 recent network intents · Wallet identity never stored in plaintext
            </div>
          </div>
        </div>
      )}

      {/* ── Solver Portal Modal ── */}
      {showSolverPortal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000,
          display: "flex", alignItems: "flex-start", justifyContent: "center",
          overflowY: "auto", padding: "32px 16px" }}
          onClick={e => { if (e.target === e.currentTarget) setShowSolverPortal(false); }}>
          <div style={{ background: "#0d0e1a", border: "1px solid rgba(245,158,11,0.2)",
            borderRadius: "22px", width: "100%", maxWidth: "700px", padding: "28px", color: "#e2e8f0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "22px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "20px" }}>⭐</span>
                  <span style={{ fontSize: "20px", fontWeight: 800 }}>Solver Portal</span>
                  {chip("PERMISSIONLESS", "#f59e0b")}
                </div>
                <div style={{ fontSize: "13px", color: "#475569", marginTop: "4px" }}>
                  Anyone can join and earn fees by delivering native tokens.
                </div>
              </div>
              <button onClick={() => setShowSolverPortal(false)} style={{
                background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                color: "#64748b", fontSize: "18px", width: "36px", height: "36px",
                borderRadius: "9px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              }}>✕</button>
            </div>

            {/* Solver list */}
            <div style={{ marginBottom: "22px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase",
                letterSpacing: "1px", marginBottom: "10px" }}>
                Live Marketplace — {loadingSolvers ? "loading…" : `${solverList.length} solvers`}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "7px", maxHeight: "240px", overflowY: "auto" }}>
                {solverList.map(s => {
                  const tc = s.type === "ai-agent" ? P : s.type === "custom" ? "#f59e0b" : "#64748b";
                  const tl = s.type === "ai-agent" ? "AI AGENT" : s.type === "custom" ? "CUSTOM" : "BUILT-IN";
                  return (
                    <div key={s.id} style={{ background: "rgba(255,255,255,0.025)",
                      border: `1px solid ${tc}16`, borderRadius: "11px", padding: "12px 14px",
                      display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                          <span style={{ fontWeight: 700, fontSize: "14px" }}>{s.name}</span>
                          {chip(tl, tc)}
                        </div>
                        <div style={{ fontSize: "11px", color: "#475569", marginTop: "3px" }}>
                          {s.supportedFromChains?.join(",") ?? "—"} → {s.supportedToChains?.join(",") ?? "—"}
                          {s.description ? ` · ${s.description.slice(0,55)}${s.description.length > 55 ? "…" : ""}` : ""}
                        </div>
                        {typeof s.totalBids === "number" && (
                          <div style={{ fontSize: "11px", color: "#334155", marginTop: "2px" }}>
                            {s.totalBids} bids · {s.wins} wins
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "15px", fontWeight: 700, color: tc }}>
                          {typeof s.baseFeePercent === "number" ? `${s.baseFeePercent}%` : s.baseFeePercent}
                        </div>
                        <div style={{ fontSize: "10px", color: "#334155" }}>fee</div>
                      </div>
                    </div>
                  );
                })}
                {solverList.length === 0 && !loadingSolvers && (
                  <div style={{ fontSize: "13px", color: "#334155", textAlign: "center", padding: "20px" }}>No solvers found</div>
                )}
              </div>
            </div>

            {/* Live solver balances */}
            {liveSolverStatus && (
              <div style={{ marginBottom: "22px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase",
                  letterSpacing: "1px", marginBottom: "10px" }}>🟢 Live Solver — Testnet Balances</div>
                <div style={{ background: `${M}06`, border: `1px solid ${M}18`,
                  borderRadius: "12px", padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  {liveSolverStatus.balances.map(b => (
                    <div key={b.chain} style={{ display: "flex", justifyContent: "space-between",
                      alignItems: "center", fontSize: "12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ width: "8px", height: "8px", borderRadius: "50%",
                          background: b.funded ? M : "#475569", display: "inline-block" }} />
                        <span style={{ color: "#94a3b8", fontWeight: 600 }}>{b.chain}</span>
                        <span style={{ color: "#334155", fontFamily: "'Space Mono', monospace",
                          fontSize: "10px" }}>{b.address.slice(0,14)}…</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ color: b.funded ? M : "#475569", fontWeight: 700,
                          fontFamily: "'Space Mono', monospace" }}>
                          {b.balance} {b.unit}
                        </span>
                        {!b.funded && (
                          <a href={b.faucetUrl} target="_blank" rel="noreferrer" style={{
                            fontSize: "10px", fontWeight: 700, color: P, textDecoration: "none",
                            background: `${P}12`, border: `1px solid ${P}28`,
                            borderRadius: "4px", padding: "2px 8px",
                          }}>Faucet ↗</a>
                        )}
                        {b.chain === "SOL" && (
                          <button onClick={() => handleAirdrop("SOL")} disabled={airdropping} style={{
                            fontSize: "10px", fontWeight: 700, color: M, cursor: "pointer",
                            background: `${M}0f`, border: `1px solid ${M}28`,
                            borderRadius: "4px", padding: "2px 8px",
                          }}>Airdrop</button>
                        )}
                      </div>
                    </div>
                  ))}
                  {airdropMsg && (
                    <div style={{ fontSize: "11px",
                      color: airdropMsg.startsWith("✅") ? M : "#fca5a5",
                      padding: "6px 10px", background: "rgba(255,255,255,0.04)", borderRadius: "6px" }}>
                      {airdropMsg}
                    </div>
                  )}
                  <div style={{ fontSize: "11px", color: "#334155" }}>
                    Fund with testnet tokens to enable real on-chain delivery. No real funds needed.
                  </div>
                </div>
              </div>
            )}

            <div style={{ height: "1px", background: "rgba(245,158,11,0.12)", marginBottom: "22px" }} />

            {/* Registration */}
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase",
              letterSpacing: "1px", marginBottom: "14px" }}>Register Your Solver</div>
            {regResult ? (
              <div style={{ background: `${M}0e`, border: `1px solid ${M}30`,
                borderRadius: "14px", padding: "24px", textAlign: "center" }}>
                <div style={{ fontSize: "28px", marginBottom: "8px" }}>✅</div>
                <div style={{ fontWeight: 800, fontSize: "16px", color: M, marginBottom: "4px" }}>{regResult.name} registered!</div>
                <div style={{ fontSize: "12px", color: "#64748b", fontFamily: "'Space Mono', monospace" }}>ID: {regResult.id}</div>
                <div style={{ fontSize: "13px", color: "#475569", marginTop: "8px" }}>
                  Your solver will participate in all matching intent bids automatically.
                </div>
                <button onClick={() => { setRegResult(null); setRegName(""); setRegDesc(""); setRegAddress(""); setRegStrategy(""); }}
                  className="pri-btn" style={{ ...primaryBtn, marginTop: "16px", fontSize: "14px" }}>
                  Register Another →
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div>
                    <div style={{ fontSize: "11px", color: "#475569", marginBottom: "5px", fontWeight: 600 }}>Solver Name *</div>
                    <input value={regName} onChange={e => setRegName(e.target.value)} placeholder="My Solver" className="pi-input" style={inp} />
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", color: "#475569", marginBottom: "5px", fontWeight: 600 }}>Operator Address *</div>
                    <input value={regAddress} onChange={e => setRegAddress(e.target.value)} placeholder="0x... or Sol1..." className="pi-input" style={inp} />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "11px", color: "#475569", marginBottom: "5px", fontWeight: 600 }}>Description</div>
                  <input value={regDesc} onChange={e => setRegDesc(e.target.value)} placeholder="Community-run solver specializing in…" className="pi-input" style={inp} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                  <div>
                    <div style={{ fontSize: "11px", color: "#475569", marginBottom: "5px", fontWeight: 600 }}>Fee %</div>
                    <input value={regFee} onChange={e => setRegFee(e.target.value)} type="number" step="0.01" min="0.05" max="2.0" className="pi-input" style={inp} />
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", color: "#475569", marginBottom: "5px", fontWeight: 600 }}>From</div>
                    <select value={regFrom} onChange={e => setRegFrom(e.target.value)} className="pi-input" style={inp}>
                      {["SOL","ETH"].map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", color: "#475569", marginBottom: "5px", fontWeight: 600 }}>To</div>
                    <select value={regTo} onChange={e => setRegTo(e.target.value)} className="pi-input" style={inp}>
                      {["ETH","SOL"].map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "11px", color: "#475569", marginBottom: "5px", fontWeight: 600 }}>Strategy (optional)</div>
                  <input value={regStrategy} onChange={e => setRegStrategy(e.target.value)}
                    placeholder="Aggressive underbid on SOL→ETH routes…" className="pi-input" style={inp} />
                </div>
                {regError && (
                  <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)",
                    borderRadius: "9px", padding: "10px 14px", fontSize: "12px", color: "#fca5a5" }}>
                    {regError}
                  </div>
                )}
                <button onClick={handleRegisterSolver} disabled={registering || !regName.trim() || !regAddress.trim()}
                  className="pri-btn" style={{ ...primaryBtn, background: "linear-gradient(135deg, #d97706, #f59e0b)" }}>
                  {registering ? "Registering…" : "Register Solver →"}
                </button>
                <div style={{ fontSize: "11px", color: "#334155", textAlign: "center" }}>
                  Permissionless · No approval needed · Immediate
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
