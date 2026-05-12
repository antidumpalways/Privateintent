import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const vaultBalancesTable = pgTable("vault_balances", {
  id: serial("id").primaryKey(),
  address: text("address").notNull().unique(),
  sol: text("sol").notNull().default("0"),
  eth: text("eth").notNull().default("0"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const vaultHistoryTable = pgTable("vault_history", {
  id: serial("id").primaryKey(),
  address: text("address").notNull(),
  type: text("type").notNull(),
  token: text("token").notNull(),
  amount: text("amount").notNull(),
  stealthAddress: text("stealth_address"),
  ts: timestamp("ts").notNull().defaultNow(),
});

export type VaultBalance = typeof vaultBalancesTable.$inferSelect;
export type VaultHistoryEntry = typeof vaultHistoryTable.$inferSelect;
