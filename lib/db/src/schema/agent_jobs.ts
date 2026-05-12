import { pgTable, serial, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";

export const agentStatusEnum = pgEnum("agent_status", ["running", "paused", "stopped"]);

export const agentJobsTable = pgTable("agent_jobs", {
  id: serial("id").primaryKey(),
  walletAddress: text("wallet_address").notNull().unique(),
  status: agentStatusEnum("status").notNull().default("stopped"),
  targetAllocations: jsonb("target_allocations").$type<Record<string, number>>(),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  log: jsonb("log").$type<string[]>().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AgentJob = typeof agentJobsTable.$inferSelect;
