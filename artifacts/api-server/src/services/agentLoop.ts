/**
 * Agent Loop Service
 *
 * Runs a background interval that:
 *  1. Scans all agent_jobs with status "running"
 *  2. Uses simulated devnet portfolio (no external data API needed — we are on testnet/devnet)
 *  3. Computes allocation drift vs. target
 *  4. If drift > DRIFT_THRESHOLD_PCT, records an agent_action audit log
 *     and (for high-risk allocations) records a "blocked" audit log
 *  5. Updates lastRunAt / nextRunAt on the job record
 */
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { agentJobsTable, auditLogsTable } from "@workspace/db/schema";
import { requestCoSignature } from "./ika.js";
import { logger } from "../lib/logger.js";

const LOOP_INTERVAL_MS = 30_000;
const DRIFT_THRESHOLD_PCT = 5;
const SUSPICIOUS_CONCENTRATION_PCT = 80;

interface AllocationMap {
  [symbol: string]: number;
}

function computeActualAllocations(
  tokens: { symbol: string; balanceUsd: number }[],
  totalUsd: number,
): AllocationMap {
  if (totalUsd === 0) return {};
  const result: AllocationMap = {};
  for (const t of tokens) {
    result[t.symbol] = (t.balanceUsd / totalUsd) * 100;
  }
  return result;
}

function detectSuspiciousConcentration(
  actual: AllocationMap,
): { suspicious: boolean; symbol: string; pct: number } | null {
  for (const [symbol, pct] of Object.entries(actual)) {
    if (pct >= SUSPICIOUS_CONCENTRATION_PCT) {
      return { suspicious: true, symbol, pct };
    }
  }
  return null;
}

// Devnet/testnet simulated portfolio — no external API needed
// Reflects realistic SOL devnet + cross-chain testnet holdings
const SIMULATED_TOKENS = [
  { contractAddress: "So11111111111111111111111111111111111111112", symbol: "SOL", balanceUsd: 8500 },
  { contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", balanceUsd: 5200 },
  { contractAddress: "CXk2AMBfi3TwaEL2468s6zP8xq9NxTXjp9gjMgzeUynM", symbol: "PYUSD", balanceUsd: 1200 },
  { contractAddress: "native-eth-sepolia", symbol: "ETH", balanceUsd: 1800 },
];

async function runAgentForJob(job: {
  walletAddress: string;
  targetAllocations: Record<string, number> | null;
  log: string[] | null;
}): Promise<void> {
  const { walletAddress, targetAllocations } = job;
  const log = job.log ?? [];

  // Use simulated devnet portfolio — Covalent does not support devnet/testnet
  const tokens = SIMULATED_TOKENS;
  const totalUsd = tokens.reduce((s, t) => s + t.balanceUsd, 0);

  const actual = computeActualAllocations(tokens, totalUsd);
  const now = new Date();
  const newLog = [...log];

  const targets: AllocationMap = targetAllocations ?? {};
  const allSymbols = new Set([...Object.keys(actual), ...Object.keys(targets)]);
  const driftEvents: { symbol: string; drift: number; actual: number; target: number }[] = [];

  for (const symbol of allSymbols) {
    const actualPct = actual[symbol] ?? 0;
    const targetPct = targets[symbol] ?? 0;
    const drift = Math.abs(actualPct - targetPct);
    if (drift > DRIFT_THRESHOLD_PCT) {
      driftEvents.push({ symbol, drift, actual: actualPct, target: targetPct });
    }
  }

  if (driftEvents.length > 0) {
    for (const event of driftEvents) {
      const direction = event.actual > event.target ? "▼ reduce" : "▲ increase";
      const reason = `Agent rebalanced ${event.symbol}: ${direction} by ${event.drift.toFixed(1)}% (actual ${event.actual.toFixed(1)}% → target ${event.target.toFixed(1)}%)`;

      // Devnet portfolio — no real blockchain tx (Covalent doesn't index devnet).
      // auditRef is a unique audit trail key for this Ika co-sign event.
      const auditRef = `devnet_rebalance:${event.symbol}:0x${randomBytes(16).toString("hex")}`;
      const token = tokens.find((t) => t.symbol === event.symbol);
      const tradeUsd = token ? Math.abs((event.drift / 100) * totalUsd) : 0;

      const coSigResult = await requestCoSignature(walletAddress, auditRef, true);

      await db.insert(auditLogsTable).values({
        walletAddress,
        txHash: auditRef,
        txType: "rebalance",
        contractAddress: token?.contractAddress ?? "0x0000000000000000000000000000000000000000",
        amountUsd: Math.round(tradeUsd * 100) / 100,
        riskScore: Math.min(Math.round(event.drift * 2), 30),
        action: "agent_action",
        reason,
        ikaCoSigned: coSigResult.coSigned,
      });

      newLog.push(`[${now.toISOString()}] ${reason}`);
      logger.info({ walletAddress, symbol: event.symbol, drift: event.drift }, "Agent: rebalance action logged");
    }
  }

  const concentrationHit = detectSuspiciousConcentration(actual);
  if (concentrationHit) {
    const { symbol, pct } = concentrationHit;
    const reason = `BLOCKED: Suspicious concentration — ${symbol} at ${pct.toFixed(1)}% of portfolio (threshold ${SUSPICIOUS_CONCENTRATION_PCT}%). Ika co-signature denied.`;

    const auditRef = `devnet_blocked:${symbol}:0x${randomBytes(16).toString("hex")}`;
    const token = tokens.find((t) => t.symbol === symbol);

    const coSigResult = await requestCoSignature(walletAddress, auditRef, false);

    await db.insert(auditLogsTable).values({
      walletAddress,
      txHash: auditRef,
      txType: "swap",
      contractAddress: token?.contractAddress ?? "0x0000000000000000000000000000000000000000",
      amountUsd: Math.round((pct / 100) * totalUsd * 100) / 100,
      riskScore: 85,
      action: "blocked",
      reason,
      ikaCoSigned: coSigResult.coSigned,
    });

    newLog.push(`[${now.toISOString()}] ${reason}`);
    logger.warn({ walletAddress, symbol, pct }, "Agent: suspicious concentration blocked");
  }

  const nextRunAt = new Date(Date.now() + LOOP_INTERVAL_MS);

  await db
    .update(agentJobsTable)
    .set({ lastRunAt: now, nextRunAt, log: newLog.slice(-50), updatedAt: now })
    .where(eq(agentJobsTable.walletAddress, walletAddress));
}

async function tick(): Promise<void> {
  let runningJobs: (typeof agentJobsTable.$inferSelect)[] = [];
  try {
    runningJobs = await db
      .select()
      .from(agentJobsTable)
      .where(eq(agentJobsTable.status, "running"));
  } catch (err) {
    logger.error({ err }, "Agent loop: failed to query running jobs");
    return;
  }

  if (runningJobs.length === 0) return;

  logger.info({ count: runningJobs.length }, "Agent loop tick: processing running jobs");

  await Promise.allSettled(
    runningJobs.map((job) =>
      runAgentForJob(job).catch((err) => {
        logger.error({ err, walletAddress: job.walletAddress }, "Agent loop: error processing job");
      }),
    ),
  );
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startAgentLoop(): void {
  if (intervalHandle !== null) return;
  logger.info({ intervalMs: LOOP_INTERVAL_MS }, "Agent loop started");
  tick();
  intervalHandle = setInterval(() => { tick(); }, LOOP_INTERVAL_MS);
}

export function stopAgentLoop(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info("Agent loop stopped");
  }
}
