import { pgTable, serial, text, boolean, real, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const auditActionEnum = pgEnum("audit_action", ["approved", "blocked", "flagged", "agent_action"]);

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  txHash: text("tx_hash"),
  txType: text("tx_type").notNull().default("transfer"),
  contractAddress: text("contract_address").notNull().default(""),
  amountUsd: real("amount_usd").notNull().default(0),
  riskScore: integer("risk_score").notNull().default(0),
  action: auditActionEnum("action").notNull().default("approved"),
  reason: text("reason"),
  ikaCoSigned: boolean("ika_co_signed").notNull().default(false),
  ikaMpcMode: text("ika_mpc_mode"),
  encryptedPayload: text("encrypted_payload"),
  encryptOnChainId: text("encrypt_on_chain_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AuditLog = typeof auditLogsTable.$inferSelect;
