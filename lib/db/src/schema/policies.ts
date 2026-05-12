import { pgTable, serial, text, boolean, real, timestamp, jsonb } from "drizzle-orm/pg-core";

export const policiesTable = pgTable("policies", {
  id: serial("id").primaryKey(),
  walletAddress: text("wallet_address").notNull().unique(),
  maxSpendPerTxUsd: real("max_spend_per_tx_usd").notNull().default(1000),
  maxDailySpendUsd: real("max_daily_spend_usd").notNull().default(5000),
  blockNewContracts: boolean("block_new_contracts").notNull().default(true),
  maxSellTaxPercent: real("max_sell_tax_percent").notNull().default(10),
  whitelistedProtocols: jsonb("whitelisted_protocols").notNull().$type<string[]>().default([]),
  targetAllocations: jsonb("target_allocations").$type<Record<string, number>>(),
  encryptedRef: text("encrypted_ref").notNull().default(""),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Policy = typeof policiesTable.$inferSelect;
