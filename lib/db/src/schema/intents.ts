import { pgTable, serial, text, integer, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core";

export const intentStatusEnum = pgEnum("intent_status", [
  "pending",
  "encrypted",
  "bidding",
  "accepted",
  "executing",
  "delivered",
  "settled",
  "failed",
  "refunded",
]);

export const intentsTable = pgTable("intents", {
  id: serial("id").primaryKey(),
  phantomPubkey: text("phantom_pubkey").notNull(),
  dwalletId: text("dwallet_id"),
  fromChain: text("from_chain").notNull(),
  toChain: text("to_chain").notNull(),
  fromToken: text("from_token").notNull(),
  toToken: text("to_token").notNull(),
  amount: text("amount").notNull(),
  destinationAddress: text("destination_address"),
  encryptedIntentId: text("encrypted_intent_id"),
  encryptedIntentHash: text("encrypted_intent_hash"),
  status: intentStatusEnum("status").notNull().default("pending"),
  winningSolverId: text("winning_solver_id"),
  solverBids: jsonb("solver_bids"),
  sourceTxId: text("source_tx_id"),
  deliveryTxId: text("delivery_tx_id"),
  proofHash: text("proof_hash"),
  escrowPda: text("escrow_pda"),
  deadline: timestamp("deadline"),
  releaseAfter: timestamp("release_after"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Intent = typeof intentsTable.$inferSelect;
export type NewIntent = typeof intentsTable.$inferInsert;
