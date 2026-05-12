/**
 * stealthKeypair — shared helper for one-time stealth address generation
 * Supports SOL (Ed25519) and ETH (secp256k1).
 * Used by both stealthReceive.ts and vault.ts.
 */

import { Keypair } from "@solana/web3.js";
import { Wallet as EthWallet } from "ethers";

export interface GeneratedKeypair {
  stealthAddress: string;
  secretKeyHex:   string;
  chain:          "SOL" | "ETH";
  network:        string;
  keySource:      string;
}

export function generateStealthKeypair(chain: "SOL" | "ETH"): GeneratedKeypair {
  if (chain === "ETH") {
    const wallet = EthWallet.createRandom();
    return {
      stealthAddress: wallet.address,
      secretKeyHex:   wallet.privateKey.slice(2),
      chain:          "ETH",
      network:        "ethereum-sepolia",
      keySource:      "secp256k1 Keypair / EIP-55 (Ika Curve25519 DKG in production; local ethers fallback for hackathon)",
    };
  }
  const keypair = Keypair.generate();
  return {
    stealthAddress: keypair.publicKey.toBase58(),
    secretKeyHex:   Buffer.from(keypair.secretKey).toString("hex"),
    chain:          "SOL",
    network:        "solana-devnet",
    keySource:      "Ed25519 Keypair (Ika Curve25519 DKG in production; local fallback for hackathon devnet)",
  };
}
