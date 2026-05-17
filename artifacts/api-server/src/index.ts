import app from "./app";
import { logger } from "./lib/logger";
import { startAgentLoop } from "./services/agentLoop.js";
import { autoRegisterLiveSolver, checkSolverCanFulfill, startSolAutoAirdropLoop, getLiveSolverCapacity } from "./services/liveSolverService.js";
import { probeIkaConnectivity, probeDkgOnStartup } from "./services/ikaMultichain.js";
import { warmRatesCache } from "./services/liveRates.js";
import { seedDarkPool, refreshBotOrders, printFundingTable } from "./services/botMarketMaker.js";
import { getSentinelKeypair } from "./services/solanaBroadcast.js";
import { SOL_ESCROW_OPERATOR } from "./services/solEscrowProgramId.js";
import { verifySolEscrowProgram } from "./services/solEscrowService.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startAgentLoop();
  autoRegisterLiveSolver();
  warmRatesCache();

  // ── Dark Pool Market Maker Bot ─────────────────────────────────────────────
  printFundingTable();
  seedDarkPool();
  // Refresh every 12 minutes: remove open bot orders, reseed fresh ones
  setInterval(refreshBotOrders, 12 * 60 * 1000);

  // ── Operator key consistency check ────────────────────────────────────────
  // The Anchor escrow program authorizes SOL_ESCROW_OPERATOR for release.
  // If the runtime sentinel key differs, on-chain release will fail with
  // "Unauthorized". This check catches mismatches at startup.
  try {
    const sentinelPubkey = getSentinelKeypair().publicKey.toBase58();
    if (sentinelPubkey !== SOL_ESCROW_OPERATOR) {
      process.stderr.write(
        `[EscrowOp] WARNING: runtime sentinel (${sentinelPubkey.slice(0, 10)}…) ` +
        `does not match on-chain OPERATOR (${SOL_ESCROW_OPERATOR.slice(0, 10)}…). ` +
        `On-chain release will fail. Set SOL_ESCROW_OPERATOR env var to the sentinel ` +
        `pubkey, or load SOLANA_SECRET_KEY_ARRAY matching the deployed operator.\n`
      );
    } else {
      process.stdout.write(
        `[EscrowOp] Sentinel pubkey matches on-chain OPERATOR (${sentinelPubkey.slice(0, 10)}…) ✓\n`
      );
    }
  } catch (e) {
    process.stderr.write(`[EscrowOp] Could not verify operator key match: ${(e as Error).message?.slice(0, 80)}\n`);
  }

  // ── Solana escrow program health check ───────────────────────────────────
  verifySolEscrowProgram().catch(() => {});

  // ── Background SOL auto-airdrop loop (devnet only) ───────────────────────
  startSolAutoAirdropLoop();

  // ── Solver inventory startup log ──────────────────────────────────────────
  setTimeout(async () => {
    try {
      const cap = await getLiveSolverCapacity();
      const solMark = cap.sol.status === "critical" ? "🔴 CRITICAL" : cap.sol.status === "low" ? "⚠️ LOW" : "✓";
      const ethMark = cap.eth.status === "critical" ? "🔴 CRITICAL" : cap.eth.status === "low" ? "⚠️ LOW" : "✓";
      process.stdout.write(
        `[SolverInventory] SOL wallet: ${cap.sol.address.slice(0, 8)}… = ${cap.sol.balance.toFixed(4)} SOL (maxDeliverable=${cap.sol.maxDeliverable.toFixed(4)} SOL) ${solMark}\n` +
        `[SolverInventory] ETH wallet: ${cap.eth.address.slice(0, 8)}… = ${cap.eth.balance.toFixed(4)} ETH (maxDeliverable=${cap.eth.maxDeliverable.toFixed(4)} ETH) ${ethMark}\n` +
        `[SolverInventory] Capacity: ETH→SOL maxInputEth=unlimited maxOutputSol=${cap.sol.maxDeliverable.toFixed(4)} SOL\n` +
        `[SolverInventory] Capacity: SOL→ETH maxInputSol=unlimited maxOutputEth=${cap.eth.maxDeliverable.toFixed(4)} ETH\n`
      );
    } catch { /* non-fatal */ }
  }, 8_000);

  // Startup Ika gRPC connectivity probe (non-blocking)
  probeIkaConnectivity().then(({ reachable, latencyMs, url, error }) => {
    if (reachable) {
      process.stdout.write(`[Ika] gRPC connectivity OK — ${url} (${latencyMs}ms)\n`);
    } else {
      const prefix = process.env.NODE_ENV === "production" ? "[Ika] CRITICAL" : "[Ika] WARN";
      process.stderr.write(`${prefix}: gRPC unreachable at startup — ${url}${error ? ` (${error})` : ""}\n`);
      process.stderr.write(`${prefix}: DKG will retry with exponential backoff until Ika network responds. No sim fallback.\n`);
    }
  }).catch(() => {});

  // Real DKG probe — actually calls Ika network to verify DKG works end-to-end.
  // Runs 5s after startup to let gRPC channel fully connect first.
  setTimeout(() => {
    probeDkgOnStartup().catch(() => {});
  }, 5_000);
});
