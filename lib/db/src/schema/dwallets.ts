import { pgTable, serial, text, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const dwalletModeEnum = pgEnum("dwallet_mode", ["protect", "automate"]);

export const dwalletsTable = pgTable("dwallets", {
  id: serial("id").primaryKey(),
  walletAddress: text("wallet_address").notNull().unique(),
  dwalletId: text("dwallet_id").notNull(),
  dwalletPublicKey: text("dwallet_public_key"),
  mode: dwalletModeEnum("mode").notNull().default("protect"),
  viewingKey: text("viewing_key").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type DWallet = typeof dwalletsTable.$inferSelect;
