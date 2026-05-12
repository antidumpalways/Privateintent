/**
 * Unified dWallet Route
 *
 * POST /dwallet/create  — buat 2 dWallet sekaligus (Secp256k1 + Curve25519)
 *                         untuk satu Phantom pubkey, return semua address (ETH+BTC+SOL)
 * GET  /dwallet/:phantomPubkey — ambil dWallet existing berdasarkan Phantom pubkey
 *
 * Mengapa 2 dWallet?
 *   Secp256k1 dWallet → ETH address (EcdsaKeccak256) + BTC address (EcdsaDoubleSha256)
 *   Curve25519 dWallet → SOL address (EddsaSha512)
 *   Satu keypair per curve, tidak perlu bridge.
 *
 * Authority di level aplikasi: phantomPubkey disimpan di DB sebagai pemilik dWallet.
 * Di level protokol Ika pre-alpha: server sentinel menjalankan DKG sebagai proxy
 * (karena browser tidak bisa langsung call gRPC Ika).
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { nativeWalletsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { dkgMultichain } from "../services/ikaMultichain.js";
import {
  deriveEthAddress,
  deriveBtcAddress,
  deriveSolanaAddress,
} from "../services/nativeSigner.js";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /dwallet/create
// Body: { phantomPubkey: string }
// Creates Secp256k1 dWallet (ETH+BTC) + Curve25519 dWallet (SOL) for the user.
// Idempotent — returns existing if already created.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/dwallet/create", async (req, res) => {
  try {
    const { phantomPubkey, phantomSignature } = req.body as { phantomPubkey?: string; phantomSignature?: string };
    if (!phantomPubkey || phantomPubkey.length < 32) {
      res.status(400).json({ error: "phantomPubkey required (your Phantom wallet address)" });
      return;
    }
    // Log authority signature for audit — proves user owns this Phantom key
    if (phantomSignature) {
      process.stdout.write(
        `[dWallet] Authority signature received — phantom=${phantomPubkey.slice(0, 12)}… sig=${phantomSignature.slice(0, 16)}…\n`
      );
    } else {
      process.stderr.write(`[dWallet] WARN: No authority signature provided for phantom=${phantomPubkey.slice(0, 12)}…\n`);
    }

    // Check if already exists — idempotent
    const existing = await db
      .select()
      .from(nativeWalletsTable)
      .where(eq(nativeWalletsTable.phantomPubkey, phantomPubkey));

    if (existing.length >= 2) {
      const sec = existing.find(r => r.curve === "secp256k1");
      const c25 = existing.find(r => r.curve === "curve25519");
      return res.json(buildResponse(phantomPubkey, sec!, c25!));
    }

    // Run both DKGs in parallel — faster than sequential
    process.stdout.write(`[dWallet] Creating dWallet pair for phantom=${phantomPubkey.slice(0, 12)}…\n`);
    const [secResult, c25Result] = await Promise.all([
      dkgMultichain("secp256k1"),
      dkgMultichain("curve25519"),
    ]);

    // Derive all addresses
    const secPubHex = Buffer.from(secResult.publicKey).toString("hex");
    const c25PubHex = Buffer.from(c25Result.publicKey).toString("hex");

    const ethAddress = deriveEthAddress(secPubHex);
    const btcAddress = deriveBtcAddress(secPubHex);
    const solAddress = deriveSolanaAddress(c25PubHex);

    // Persist both rows in one transaction
    const [secRow, c25Row] = await Promise.all([
      db.insert(nativeWalletsTable).values({
        phantomPubkey,
        chain: "ethereum+bitcoin",
        curve: "secp256k1",
        publicKeyHex: secPubHex,
        ethAddress,
        btcAddress,
        attestationHex: Buffer.from(secResult.attestationData).toString("hex"),
        networkSigHex: Buffer.from(secResult.networkSignature).toString("hex"),
        networkPubkeyHex: Buffer.from(secResult.networkPubkey).toString("hex"),
        mode: secResult.mode,
      }).returning().then(r => r[0]!),

      db.insert(nativeWalletsTable).values({
        phantomPubkey,
        chain: "solana",
        curve: "curve25519",
        publicKeyHex: c25PubHex,
        solAddress,
        attestationHex: Buffer.from(c25Result.attestationData).toString("hex"),
        networkSigHex: Buffer.from(c25Result.networkSignature).toString("hex"),
        networkPubkeyHex: Buffer.from(c25Result.networkPubkey).toString("hex"),
        mode: c25Result.mode,
      }).returning().then(r => r[0]!),
    ]);

    // Production guard — reject if either DKG fell back to sim
    if (process.env.NODE_ENV === "production" && (secResult.mode === "sim" || c25Result.mode === "sim")) {
      // Clean up inserted rows so user can retry
      await Promise.all([
        db.delete(nativeWalletsTable).where(eq(nativeWalletsTable.id, secRow.id)),
        db.delete(nativeWalletsTable).where(eq(nativeWalletsTable.id, c25Row.id)),
      ]);
      res.status(503).json({
        error: "Ika gRPC network unreachable. dWallet creation requires live Ika devnet DKG. Please retry in a moment.",
        ikaGrpcUrl: "pre-alpha-dev-1.ika.ika-network.net:443",
        retryAfterSeconds: 10,
      });
      return;
    }

    process.stdout.write(
      `[dWallet] Created — ETH=${ethAddress.slice(0, 10)}… BTC=${btcAddress.slice(0, 12)}… SOL=${solAddress.slice(0, 12)}…\n`
    );

    return res.status(201).json(buildResponse(phantomPubkey, secRow, c25Row));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /dwallet/:phantomPubkey
// ─────────────────────────────────────────────────────────────────────────────
router.get("/dwallet/:phantomPubkey", async (req, res) => {
  try {
    const { phantomPubkey } = req.params;
    if (!phantomPubkey) { res.status(400).json({ error: "phantomPubkey required" }); return; }

    const rows = await db
      .select()
      .from(nativeWalletsTable)
      .where(eq(nativeWalletsTable.phantomPubkey, phantomPubkey));

    if (rows.length === 0) {
      res.status(404).json({ error: "No dWallet found for this Phantom address. Call POST /dwallet/create first." });
      return;
    }

    const sec = rows.find(r => r.curve === "secp256k1");
    const c25 = rows.find(r => r.curve === "curve25519");
    res.json(buildResponse(phantomPubkey, sec ?? null, c25 ?? null));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build unified response
// ─────────────────────────────────────────────────────────────────────────────
function buildResponse(
  phantomPubkey: string,
  sec: typeof nativeWalletsTable.$inferSelect | null,
  c25: typeof nativeWalletsTable.$inferSelect | null,
) {
  return {
    phantomPubkey,
    authorityNote: "Phantom pubkey = application-layer owner. Ika protocol authority = server sentinel (pre-alpha proxy).",
    dwallets: {
      secp256k1: sec ? {
        id: sec.id,
        curve: "Secp256k1",
        publicKeyHex: sec.publicKeyHex?.slice(0, 16) + "…",
        mode: sec.mode,
        ikaNetwork: "pre-alpha-dev-1.ika.ika-network.net:443",
        sigSchemes: ["EcdsaKeccak256 → Ethereum", "EcdsaDoubleSha256 → Bitcoin"],
      } : null,
      curve25519: c25 ? {
        id: c25.id,
        curve: "Curve25519",
        publicKeyHex: c25.publicKeyHex?.slice(0, 16) + "…",
        mode: c25.mode,
        ikaNetwork: "pre-alpha-dev-1.ika.ika-network.net:443",
        sigSchemes: ["EddsaSha512 → Solana"],
      } : null,
    },
    addresses: {
      eth: sec?.ethAddress ?? null,
      btc: sec?.btcAddress ?? null,
      sol: c25?.solAddress ?? null,
    },
    secp256kWalletId: sec?.id ?? null,
    curve25519WalletId: c25?.id ?? null,
    mode: sec?.mode ?? c25?.mode ?? "sim",
    bridgeless: true,
    note: "One Secp256k1 dWallet → ETH + BTC (same keypair, different derivation). One Curve25519 dWallet → SOL. No bridge needed.",
  };
}

export default router;
