import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const nativeWalletsTable = pgTable("native_wallets", {
  id: serial("id").primaryKey(),
  phantomPubkey: text("phantom_pubkey"),      // Phantom wallet = application-layer authority
  chain: text("chain").notNull(),             // ethereum | bitcoin | solana | unified
  curve: text("curve").notNull(),             // secp256k1 | curve25519
  publicKeyHex: text("public_key_hex"),       // DKG public key (hex)
  ethAddress: text("eth_address"),            // 0x Ethereum address (secp256k1 only)
  btcAddress: text("btc_address"),            // tb1q… Bitcoin testnet (secp256k1 only)
  solAddress: text("sol_address"),            // base58 Solana address (curve25519 only)
  attestationHex: text("attestation_hex"),    // full DKG attestation bytes (for presign/sign)
  networkSigHex: text("network_sig_hex"),     // Ika network signature (hex)
  networkPubkeyHex: text("network_pubkey_hex"), // Ika network pubkey (hex)
  mode: text("mode").notNull().default("devnet"), // devnet | sim
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type NativeWallet = typeof nativeWalletsTable.$inferSelect;
