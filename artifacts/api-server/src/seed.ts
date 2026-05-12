/**
 * Seed script — inserts demo data for SentinelWallet hackathon demo
 * Run: pnpm --filter @workspace/api-server run seed
 */
import { db } from "@workspace/db";
import {
  dwalletsTable,
  policiesTable,
  auditLogsTable,
  agentJobsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";
import { hashViewingKey } from "./services/encrypt.js";

const DEMO_WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

async function seed() {
  console.log("Seeding demo data...");

  // Clean existing demo data
  await db.delete(auditLogsTable).where(eq(auditLogsTable.walletAddress, DEMO_WALLET));
  await db.delete(agentJobsTable).where(eq(agentJobsTable.walletAddress, DEMO_WALLET));
  await db.delete(policiesTable).where(eq(policiesTable.walletAddress, DEMO_WALLET));
  await db.delete(dwalletsTable).where(eq(dwalletsTable.walletAddress, DEMO_WALLET));

  // Create demo dWallet
  const seed = createHash("sha256").update(`dwallet:${DEMO_WALLET}`).digest();
  const dwalletId = `0x${seed.toString("hex").slice(0, 64)}`;
  // Generate viewing key — for demo, print once; in production client stores this
  const viewingKey = randomBytes(32).toString("base64url");
  const viewingKeyHash = hashViewingKey(viewingKey);
  console.log("Demo viewing key (for audit decrypt):", viewingKey);

  const [dw] = await db
    .insert(dwalletsTable)
    .values({
      walletAddress: DEMO_WALLET,
      dwalletId,
      mode: "protect",
      viewingKey: viewingKeyHash,  // store hash only, not plaintext
      isActive: true,
    })
    .returning();

  console.log("Created dWallet:", dw!.dwalletId);

  // Create demo policy
  const [policy] = await db
    .insert(policiesTable)
    .values({
      walletAddress: DEMO_WALLET,
      maxSpendPerTxUsd: 1000,
      maxDailySpendUsd: 5000,
      blockNewContracts: true,
      maxSellTaxPercent: 10,
      whitelistedProtocols: ["0xUniswapV3", "0xAave", "0xCurve"],
      targetAllocations: { USDC: 40, WETH: 35, DAI: 25 },
      encryptedRef: "enc_demo_policy_ref_001",
    })
    .returning();

  console.log("Created policy:", policy!.encryptedRef);

  // Seed audit logs
  const auditEntries = [
    {
      walletAddress: DEMO_WALLET,
      txHash: `0x${randomBytes(32).toString("hex")}`,
      txType: "swap",
      contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      amountUsd: 500,
      riskScore: 12,
      action: "approved" as const,
      ikaCoSigned: true,
      reason: null,
    },
    {
      walletAddress: DEMO_WALLET,
      txHash: null,
      txType: "approve",
      contractAddress: "0x000000000000000000000000000000000000dead",
      amountUsd: 15000,
      riskScore: 88,
      action: "blocked" as const,
      ikaCoSigned: false,
      reason: "High risk score: 88/100 — suspicious address pattern",
    },
    {
      walletAddress: DEMO_WALLET,
      txHash: `0x${randomBytes(32).toString("hex")}`,
      txType: "transfer",
      contractAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      amountUsd: 2500,
      riskScore: 65,
      action: "flagged" as const,
      ikaCoSigned: false,
      reason: "Contract is only 18 days old (< 30 day threshold)",
    },
    {
      walletAddress: DEMO_WALLET,
      txHash: `0x${randomBytes(32).toString("hex")}`,
      txType: "rebalance",
      contractAddress: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      amountUsd: 800,
      riskScore: 8,
      action: "agent_action" as const,
      ikaCoSigned: true,
      reason: "Agent rebalanced USDC allocation +3.2%",
    },
    {
      walletAddress: DEMO_WALLET,
      txHash: `0x${randomBytes(32).toString("hex")}`,
      txType: "swap",
      contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      amountUsd: 200,
      riskScore: 5,
      action: "approved" as const,
      ikaCoSigned: true,
      reason: null,
    },
  ];

  for (const entry of auditEntries) {
    await db.insert(auditLogsTable).values(entry);
  }

  console.log(`Seeded ${auditEntries.length} audit logs`);

  // Create agent job
  const [agent] = await db
    .insert(agentJobsTable)
    .values({
      walletAddress: DEMO_WALLET,
      status: "paused",
      targetAllocations: { USDC: 40, WETH: 35, DAI: 25 },
      lastRunAt: new Date(Date.now() - 60 * 60 * 1000),
      nextRunAt: new Date(Date.now() + 60 * 1000),
      log: [
        `[${new Date().toISOString()}] Agent initialized`,
        `[${new Date().toISOString()}] Last rebalance: USDC +3.2%, WETH -1.8%`,
      ],
    })
    .returning();

  console.log("Created agent job:", agent!.status);
  console.log("Seed complete.");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
