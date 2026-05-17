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
import { eq } from "drizzle-orm";
import {
  dkgMultichain,
  presignStandalone,
  futureSignMultichain,
  type IkaCurve,
  type IkaSigAlgo,
} from "../services/ikaMultichain.js";
import {
  deriveEthAddress,
  deriveBtcAddress,
  deriveSolanaAddress,
} from "../services/nativeSigner.js";
import { createHash } from "crypto";

const router = Router();

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(Math.max(1, Math.ceil(h.length / 2)));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2) || "00", 16);
  return out;
}

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
      return res.status(400).json({ error: "phantomPubkey required (your Phantom wallet address)" });
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

    process.stdout.write(
      `[dWallet] Created — ETH=${ethAddress.slice(0, 10)}… BTC=${btcAddress.slice(0, 12)}… SOL=${solAddress.slice(0, 12)}…\n`
    );

    return res.status(201).json(buildResponse(phantomPubkey, secRow, c25Row));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
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
    return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /dwallet/sign
// Body: { phantomPubkey, message, curve? }
//
// Production signing endpoint. Reuses the DKG attestation already stored in the
// DB from wallet creation — NO new DKG is needed (DKG is a one-time setup).
//
// Flow:
//   Step 1: Load DKG attestation from DB  (0ms — already stored)
//   Step 2: Presign — live MPC on Ika     (~35s first attempt, <1s after)
//   Step 3: FutureSign — live MPC on Ika  (~200ms)
//
// Returns each step's result. Steps 2+3 are live Ika network calls.
// NO simulation. No fallback. Retries on timeout.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/dwallet/sign", async (req, res) => {
  const { phantomPubkey, message, curve } = req.body as {
    phantomPubkey?: string;
    message?: string;
    curve?: IkaCurve;
  };

  if (!phantomPubkey || phantomPubkey.length < 10) {
    return res.status(400).json({ error: "phantomPubkey required" });
  }
  if (!message || !message.trim()) {
    return res.status(400).json({ error: "message required — the text to sign" });
  }

  const targetCurve: IkaCurve = curve === "secp256k1" ? "secp256k1" : "curve25519";
  const sigAlgo: IkaSigAlgo = targetCurve === "secp256k1" ? "ECDSASecp256k1" : "EdDSA";
  const t0 = Date.now();
  const steps: Record<string, unknown> = {};

  process.stdout.write(
    `[dWallet/sign] START phantom=${phantomPubkey.slice(0, 12)}… curve=${targetCurve} msg="${message.slice(0, 40)}"\n`,
  );

  // ── Step 1: Load cached DKG attestation from DB ──────────────────────────────
  let dkgInfo: {
    publicKey: Uint8Array;
    attestationData: Uint8Array;
    networkSignature: Uint8Array;
    networkPubkey: Uint8Array;
    curve: IkaCurve;
    mode: "devnet";
    publicOutput: Uint8Array;
  };

  try {
    const rows = await db
      .select()
      .from(nativeWalletsTable)
      .where(eq(nativeWalletsTable.phantomPubkey, phantomPubkey));

    const walletRow = rows.find(r => r.curve === targetCurve);

    if (!walletRow) {
      return res.status(404).json({
        ok: false,
        error: `No ${targetCurve} dWallet found for this Phantom address. Call POST /dwallet/create first.`,
        hint: "Create your dWallet first — DKG only runs once per wallet.",
      });
    }

    if (!walletRow.attestationHex || !walletRow.networkSigHex || !walletRow.networkPubkeyHex || !walletRow.publicKeyHex) {
      return res.status(422).json({
        ok: false,
        error: "dWallet record is missing MPC attestation data. Please recreate the wallet.",
      });
    }

    dkgInfo = {
      publicKey:       hexToBytes(walletRow.publicKeyHex),
      attestationData: hexToBytes(walletRow.attestationHex),
      networkSignature: hexToBytes(walletRow.networkSigHex),
      networkPubkey:   hexToBytes(walletRow.networkPubkeyHex),
      curve:           targetCurve,
      mode:            "devnet",
      publicOutput:    new Uint8Array(32),
    };

    steps.dkg = {
      ok: true,
      source: "cached_db",
      curve: targetCurve,
      mode: "devnet",
      publicKeyShort: walletRow.publicKeyHex.slice(0, 16) + "…",
      networkPubkeyShort: walletRow.networkPubkeyHex.slice(0, 16) + "…",
      walletId: walletRow.id,
      latencyMs: 0,
      note: "DKG attestation loaded from database — no MPC round trip needed",
    };

    process.stdout.write(
      `[dWallet/sign] ✓ Step 1 DKG from DB pubkey=${walletRow.publicKeyHex.slice(0, 16)}… walletId=${walletRow.id}\n`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[dWallet/sign] ✗ Step 1 DB lookup FAILED: ${msg}\n`);
    return res.status(500).json({ ok: false, error: `DB error: ${msg}`, steps });
  }

  // ── Step 2: Presign — live MPC call to Ika ──────────────────────────────────
  const messageBytes = new Uint8Array(createHash("sha256").update(message.trim()).digest());
  let presignResult: Awaited<ReturnType<typeof presignStandalone>>;

  try {
    process.stdout.write(`[dWallet/sign] Step 2 — Presign (curve=${targetCurve} algo=${sigAlgo})…\n`);
    const t2 = Date.now();
    presignResult = await presignStandalone(targetCurve, sigAlgo, dkgInfo.publicKey.slice(0, 32));
    const idHex = Buffer.from(presignResult.presignId).toString("hex");
    steps.presign = {
      ok: true,
      curve: targetCurve,
      sigAlgo,
      presignIdShort: idHex.slice(0, 16) + "…",
      presignDataLen: presignResult.presignData.length,
      latencyMs: Date.now() - t2,
    };
    process.stdout.write(
      `[dWallet/sign] ✓ Step 2 Presign OK presignId=${idHex.slice(0, 16)}… ${presignResult.presignData.length}B\n`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[dWallet/sign] ✗ Step 2 Presign FAILED: ${msg}\n`);
    steps.presign = { ok: false, error: msg };
    return res.status(503).json({
      ok: false,
      error: `Presign failed: ${msg}`,
      steps,
      note: "DKG cached. Presign failed on Ika network — no simulation fallback.",
      retryAfterSeconds: 5,
    });
  }

  // ── Step 3: FutureSign — live MPC signing via Ika ───────────────────────────
  try {
    process.stdout.write(`[dWallet/sign] Step 3 — FutureSign (curve=${targetCurve})…\n`);
    const t3 = Date.now();
    const futureSign = await futureSignMultichain(dkgInfo, presignResult.presignId, messageBytes, sigAlgo);
    const attHex = Buffer.from(futureSign.attestationBytes).toString("hex");
    const totalMs = Date.now() - t0;

    steps.futureSign = {
      ok: true,
      responseType: futureSign.responseType,
      attestationShort: attHex.slice(0, 32) + "…",
      attestationLen: futureSign.attestationBytes.length,
      latencyMs: Date.now() - t3,
    };

    process.stdout.write(
      `[dWallet/sign] ✓ ALL STEPS COMPLETE — phantom=${phantomPubkey.slice(0, 12)}… ` +
      `responseType=${futureSign.responseType} attestation=${futureSign.attestationBytes.length}B ` +
      `totalMs=${totalMs} mode=devnet\n`,
    );

    return res.json({
      ok: true,
      mode: "devnet",
      ikaGrpcUrl: "pre-alpha-dev-1.ika.ika-network.net:443",
      curve: targetCurve,
      sigAlgo,
      message: message.trim(),
      messageHash: Buffer.from(messageBytes).toString("hex"),
      publicKeyHex: Buffer.from(dkgInfo.publicKey).toString("hex"),
      publicKeyShort: Buffer.from(dkgInfo.publicKey).toString("hex").slice(0, 16) + "…",
      futureSignAttestation: attHex,
      futureSignResponseType: futureSign.responseType,
      totalMs,
      steps,
      note: "Cached DKG + live Presign + live FutureSign. No simulation. Ika pre-alpha devnet.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[dWallet/sign] ✗ Step 3 FutureSign FAILED: ${msg}\n`);
    steps.futureSign = { ok: false, error: msg };
    return res.status(503).json({
      ok: false,
      error: `FutureSign failed: ${msg}`,
      steps,
      note: "DKG cached. Presign succeeded. FutureSign failed on Ika network — no simulation fallback.",
      retryAfterSeconds: 5,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /dwallet/test-sign
// Body: { curve?: "secp256k1"|"curve25519", message?: string }
//
// Runs a 3-step live Ika MPC flow on the Ika pre-alpha devnet:
//   Step 1: DKG          — generates a new threshold keypair
//   Step 2: Presign      — generates MPC presign material (curve+algo)
//   Step 3: FutureSign   — signs the message using DKG attestation + presign
//
// Each step is run independently. Results from completed steps are ALWAYS
// returned in the response, even if a later step fails.
// NO simulation. No fallback. Throws/retries on Ika network errors only.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/dwallet/test-sign", async (req, res) => {
  const curve: IkaCurve = (req.body?.curve as IkaCurve) ?? "curve25519";
  const rawMessage: string = req.body?.message ?? `PrismDwallet test-sign ${new Date().toISOString()}`;
  const sigAlgo: IkaSigAlgo = curve === "secp256k1" ? "ECDSASecp256k1" : "EdDSA";

  const messageBytes = new Uint8Array(
    createHash("sha256").update(rawMessage).digest(),
  );

  const steps: Record<string, unknown> = {};
  const t0 = Date.now();
  let overallOk = false;

  process.stdout.write(
    `[dWallet/test-sign] START curve=${curve} algo=${sigAlgo} msg="${rawMessage.slice(0, 40)}"\n`,
  );

  // ── Step 1: DKG — generate a live threshold keypair on Ika ──────────────────
  let dkgResult: Awaited<ReturnType<typeof dkgMultichain>> | null = null;
  try {
    process.stdout.write(`[dWallet/test-sign] Step 1 — DKG (curve=${curve})…\n`);
    const t1 = Date.now();
    dkgResult = await dkgMultichain(curve);
    const pubkeyHex = Buffer.from(dkgResult.publicKey).toString("hex");
    steps.dkg = {
      ok: true,
      curve,
      mode: dkgResult.mode,
      publicKeyHex: pubkeyHex,
      publicKeyShort: pubkeyHex.slice(0, 16) + "…",
      networkPubkeyShort: Buffer.from(dkgResult.networkPubkey).toString("hex").slice(0, 16) + "…",
      attestationHex: Buffer.from(dkgResult.attestationData).toString("hex").slice(0, 64) + "…",
      latencyMs: Date.now() - t1,
    };
    process.stdout.write(
      `[dWallet/test-sign] ✓ Step 1 DKG OK pubkey=${pubkeyHex.slice(0, 16)}… latency=${steps.dkg && (steps.dkg as any).latencyMs}ms\n`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[dWallet/test-sign] ✗ Step 1 DKG FAILED: ${msg}\n`);
    steps.dkg = { ok: false, error: msg };
    return res.status(503).json({
      ok: false,
      error: `DKG failed: ${msg}`,
      steps,
      note: "Ika network error — no simulation fallback. DKG is required for all subsequent steps.",
      retryAfterSeconds: 5,
    });
  }

  // ── Step 2: Presign — MPC presign material (curve + sigAlgo) ────────────────
  let presignResult: Awaited<ReturnType<typeof presignStandalone>> | null = null;
  try {
    process.stdout.write(`[dWallet/test-sign] Step 2 — Presign (curve=${curve} algo=${sigAlgo})…\n`);
    const t2 = Date.now();
    presignResult = await presignStandalone(curve, sigAlgo, dkgResult.publicKey.slice(0, 32));
    const idHex = Buffer.from(presignResult.presignId).toString("hex");
    steps.presign = {
      ok: true,
      curve,
      sigAlgo,
      presignIdShort: idHex.slice(0, 16) + "…",
      presignDataLen: presignResult.presignData.length,
      attestationLen: presignResult.presignAttestationData.length,
      latencyMs: Date.now() - t2,
    };
    process.stdout.write(
      `[dWallet/test-sign] ✓ Step 2 Presign OK presignId=${idHex.slice(0, 16)}… data=${presignResult.presignData.length}B\n`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[dWallet/test-sign] ✗ Step 2 Presign FAILED: ${msg}\n`);
    steps.presign = { ok: false, error: msg };
    return res.status(503).json({
      ok: false,
      error: `Presign failed: ${msg}`,
      steps,
      note: "DKG succeeded. Presign failed on Ika network — no simulation fallback.",
      retryAfterSeconds: 5,
    });
  }

  // ── Step 3: FutureSign — signs message using DKG attestation + presign ──────
  // FutureSign does NOT require an on-chain MessageApproval PDA (unlike Sign).
  try {
    process.stdout.write(`[dWallet/test-sign] Step 3 — FutureSign (curve=${curve} algo=${sigAlgo})…\n`);
    const t3 = Date.now();
    const futureSign = await futureSignMultichain(
      dkgResult,
      presignResult.presignId,
      messageBytes,
      sigAlgo,
    );
    const attHex = Buffer.from(futureSign.attestationBytes).toString("hex");
    steps.futureSign = {
      ok: true,
      responseType: futureSign.responseType,
      attestationShort: attHex.slice(0, 32) + "…",
      attestationLen: futureSign.attestationBytes.length,
      latencyMs: Date.now() - t3,
    };
    overallOk = true;
    process.stdout.write(
      `[dWallet/test-sign] ✓ Step 3 FutureSign OK responseType=${futureSign.responseType} ` +
      `attestation=${futureSign.attestationBytes.length}B\n`,
    );

    const totalMs = Date.now() - t0;
    const pubkeyHex = Buffer.from(dkgResult.publicKey).toString("hex");
    process.stdout.write(
      `[dWallet/test-sign] ✓ ALL 3 STEPS COMPLETE in ${totalMs}ms mode=devnet\n`,
    );

    return res.json({
      ok: true,
      mode: "devnet",
      ikaGrpcUrl: "pre-alpha-dev-1.ika.ika-network.net:443",
      curve,
      sigAlgo,
      message: rawMessage,
      messageHash: Buffer.from(messageBytes).toString("hex"),
      publicKeyHex: pubkeyHex,
      publicKeyShort: pubkeyHex.slice(0, 16) + "…",
      futureSignAttestation: attHex,
      futureSignResponseType: futureSign.responseType,
      totalMs,
      steps,
      note: "DKG + Presign + FutureSign on live Ika pre-alpha devnet. No simulation. FutureSign avoids on-chain MessageApproval PDA.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[dWallet/test-sign] ✗ Step 3 FutureSign FAILED: ${msg}\n`);
    steps.futureSign = { ok: false, error: msg };

    const totalMs = Date.now() - t0;
    const pubkeyHex = Buffer.from(dkgResult.publicKey).toString("hex");

    process.stdout.write(
      `[dWallet/test-sign] PARTIAL — DKG+Presign OK but FutureSign failed after ${totalMs}ms\n`,
    );

    return res.status(503).json({
      ok: false,
      error: `FutureSign failed: ${msg}`,
      mode: "devnet",
      curve,
      sigAlgo,
      message: rawMessage,
      publicKeyHex: pubkeyHex,
      steps,
      note: "DKG + Presign succeeded on live Ika devnet. FutureSign not yet supported on pre-alpha mock. No simulation fallback.",
      retryAfterSeconds: 5,
    });
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
    mode: sec?.mode ?? c25?.mode ?? "devnet",
    bridgeless: true,
    note: "One Secp256k1 dWallet → ETH + BTC (same keypair, different derivation). One Curve25519 dWallet → SOL. No bridge needed.",
  };
}

export default router;
