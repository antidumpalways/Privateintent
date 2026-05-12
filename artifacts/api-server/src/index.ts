import app from "./app";
import { logger } from "./lib/logger";
import { startAgentLoop } from "./services/agentLoop.js";
import { autoRegisterLiveSolver } from "./services/liveSolverService.js";
import { probeIkaConnectivity } from "./services/ikaMultichain.js";
import { warmRatesCache } from "./services/liveRates.js";
import { seedDarkPool, refreshBotOrders, printFundingTable } from "./services/botMarketMaker.js";

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

  // Startup Ika gRPC connectivity probe (non-blocking)
  probeIkaConnectivity().then(({ reachable, latencyMs, url, error }) => {
    if (reachable) {
      process.stdout.write(`[Ika] gRPC connectivity OK — ${url} (${latencyMs}ms)\n`);
    } else {
      const prefix = process.env.NODE_ENV === "production" ? "[Ika] CRITICAL" : "[Ika] WARN";
      process.stderr.write(`${prefix}: gRPC unreachable at startup — ${url}${error ? ` (${error})` : ""}\n`);
      process.stderr.write(`${prefix}: DKG will retry ${3}x per request before falling back to sim mode.\n`);
    }
  }).catch(() => {});
});
