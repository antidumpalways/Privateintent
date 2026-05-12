/**
 * Native Multi-Chain Signing Routes
 *
 * POST /native/wallet/create  — DKG via Ika → derive ETH/BTC/SOL address
 * POST /native/sign/eth       — Sign + broadcast Ethereum tx on Sepolia
 * POST /native/sign/btc       — Sign + broadcast Bitcoin tx on Testnet3
 * POST /native/sign/sol       — Sign + broadcast Solana tx on Devnet
 * GET  /native/wallet/:id     — Get wallet + addresses
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { nativeWalletsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  createNativeWallet,
  signAndBroadcastEthTx,
  signAndBroadcastBtcTx,
  signAndBroadcastSolTx,
  type SupportedChain,
  type MultiChainWallet,
} from "../services/nativeSigner.js";
import type { MultichainDWalletResult } from "../services/ikaMultichain.js";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /native/wallet/create
// Body: { chain: "ethereum" | "bitcoin" | "solana" | "polkadot" }
// ─────────────────────────────────────────────────────────────────────────────

router.post("/native/wallet/create", async (req, res) => {
  try {
    const { chain } = req.body as { chain?: SupportedChain };
    if (!chain || !["ethereum", "bitcoin", "solana", "polkadot"].includes(chain)) {
      res.status(400).json({ error: "chain required: ethereum | bitcoin | solana | polkadot" });
      return;
    }

    const wallet = await createNativeWallet(chain);

    // Persist to DB
    const [row] = await db
      .insert(nativeWalletsTable)
      .values({
        chain,
        curve: wallet.curve,
        publicKeyHex: wallet.publicKeyHex,
        ethAddress: wallet.addresses.eth ?? null,
        btcAddress: wallet.addresses.btc ?? null,
        solAddress: wallet.addresses.sol ?? null,
        attestationHex: Buffer.from(wallet.dwalletInfo.attestationData).toString("hex"),
        networkSigHex: Buffer.from(wallet.dwalletInfo.networkSignature).toString("hex"),
        networkPubkeyHex: Buffer.from(wallet.dwalletInfo.networkPubkey).toString("hex"),
        mode: wallet.mode,
      })
      .returning();

    res.status(201).json({
      id: row!.id,
      chain: row!.chain,
      curve: row!.curve,
      mode: row!.mode,
      addresses: {
        eth: row!.ethAddress,
        btc: row!.btcAddress,
        sol: row!.solAddress,
      },
      publicKeyHex: row!.publicKeyHex,
      ikaNetwork: "pre-alpha-dev-1.ika.ika-network.net:443",
      signingCapability: capabilityForChain(chain),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /native/wallet/:id
// ─────────────────────────────────────────────────────────────────────────────

router.get("/native/wallet/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id ?? "0", 10);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

    const [row] = await db
      .select()
      .from(nativeWalletsTable)
      .where(eq(nativeWalletsTable.id, id))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Wallet not found" }); return; }

    res.json({
      id: row.id,
      chain: row.chain,
      curve: row.curve,
      mode: row.mode,
      addresses: { eth: row.ethAddress, btc: row.btcAddress, sol: row.solAddress },
      publicKeyHex: row.publicKeyHex,
      signingCapability: capabilityForChain(row.chain as SupportedChain),
      createdAt: row.createdAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /native/wallets — list all
// ─────────────────────────────────────────────────────────────────────────────

router.get("/native/wallets", async (_req, res) => {
  try {
    const rows = await db.select().from(nativeWalletsTable).orderBy(nativeWalletsTable.id);
    res.json(
      rows.map((r) => ({
        id: r.id,
        chain: r.chain,
        curve: r.curve,
        mode: r.mode,
        addresses: { eth: r.ethAddress, btc: r.btcAddress, sol: r.solAddress },
        publicKeyHex: r.publicKeyHex?.slice(0, 16) + "…",
        createdAt: r.createdAt,
      })),
    );
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /native/sign/eth
// Body: { walletId, to, valueEth, data? }
// ─────────────────────────────────────────────────────────────────────────────

router.post("/native/sign/eth", async (req, res) => {
  try {
    const { walletId, to, valueEth, data } = req.body as {
      walletId?: number;
      to?: string;
      valueEth?: string;
      data?: string;
    };

    if (!walletId || !to || !valueEth) {
      res.status(400).json({ error: "walletId, to, valueEth required" }); return;
    }

    const wallet = await loadWallet(walletId, "ethereum");
    const result = await signAndBroadcastEthTx(wallet.dwalletInfo, { to, valueEth, data });

    res.json({
      chain: "ethereum",
      network: "sepolia",
      txHash: result.txHash,
      from: result.from,
      to,
      valueEth,
      explorerUrl: result.explorerUrl,
      ikaCoSigned: true,
      sigMode: result.sigMode,
      sigScheme: "EcdsaKeccak256 (Secp256k1 ECDSA + keccak256)",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /native/sign/btc
// Body: { walletId, to, satoshis, utxos: [{txid,vout,value}], feeRate? }
// ─────────────────────────────────────────────────────────────────────────────

router.post("/native/sign/btc", async (req, res) => {
  try {
    const { walletId, to, satoshis, utxos, feeRate } = req.body as {
      walletId?: number;
      to?: string;
      satoshis?: number;
      utxos?: { txid: string; vout: number; value: number }[];
      feeRate?: number;
    };

    if (!walletId || !to || !satoshis) {
      res.status(400).json({ error: "walletId, to, satoshis required" }); return;
    }

    // Load wallet once — needed for both UTXO discovery and signing
    const btcWallet = await loadWallet(walletId, "bitcoin");

    // Fetch real UTXOs from mempool.space testnet if caller didn't provide them
    let effectiveUtxos = utxos && utxos.length > 0 ? utxos : [];
    if (effectiveUtxos.length === 0) {
      const btcAddr = btcWallet.addresses.btc;
      if (btcAddr) {
        try {
          const utxoResp = await fetch(`https://mempool.space/testnet/api/address/${btcAddr}/utxo`);
          if (utxoResp.ok) {
            const rawUtxos = await utxoResp.json() as Array<{ txid: string; vout: number; value: number }>;
            effectiveUtxos = rawUtxos.map(u => ({ txid: u.txid, vout: u.vout, value: u.value }));
            process.stdout.write(`[native/btc] fetched ${effectiveUtxos.length} real UTXOs from mempool.space for ${btcAddr}\n`);
          }
        } catch (e) {
          process.stderr.write(`[native/btc] mempool.space UTXO fetch failed: ${(e as Error).message}\n`);
        }
      }
      if (effectiveUtxos.length === 0) {
        res.status(402).json({
          error: "No UTXOs found for this dWallet BTC address. Fund it from a Bitcoin testnet3 faucet first.",
          btcAddress: btcWallet.addresses.btc,
          faucetUrl: "https://coinfaucet.eu/en/btc-testnet",
        });
        return;
      }
    }

    const result = await signAndBroadcastBtcTx(btcWallet.dwalletInfo, {
      to, satoshis, utxos: effectiveUtxos, feeRate,
    });

    res.json({
      chain: "bitcoin",
      network: "testnet3",
      txId: result.txId,
      from: result.from,
      to,
      satoshis,
      explorerUrl: result.explorerUrl,
      ikaCoSigned: true,
      sigMode: result.sigMode,
      sigScheme: "EcdsaDoubleSha256 (Secp256k1 ECDSA + SHA256d)",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /native/sign/sol
// Body: { walletId, to, lamports }
// ─────────────────────────────────────────────────────────────────────────────

router.post("/native/sign/sol", async (req, res) => {
  try {
    const { walletId, to, lamports } = req.body as {
      walletId?: number;
      to?: string;
      lamports?: number;
    };

    if (!walletId || !to || !lamports) {
      res.status(400).json({ error: "walletId, to, lamports required" }); return;
    }

    const wallet = await loadWallet(walletId, "solana");
    const result = await signAndBroadcastSolTx(wallet.dwalletInfo, { to, lamports });

    res.json({
      chain: "solana",
      network: "devnet",
      signature: result.signature,
      from: result.from,
      to,
      lamports,
      sol: (lamports / 1_000_000_000).toFixed(6),
      explorerUrl: result.explorerUrl,
      ikaCoSigned: true,
      sigMode: result.sigMode,
      sigScheme: "EddsaSha512 (Curve25519 Ed25519)",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /native/demo — quick demo: create + sign all chains
// ─────────────────────────────────────────────────────────────────────────────

router.post("/native/demo", async (req, res) => {
  const { chains = ["ethereum", "bitcoin", "solana"] } = req.body as {
    chains?: SupportedChain[];
  };

  const results: Record<string, unknown> = {};

  for (const chain of chains) {
    try {
      const wallet = await createNativeWallet(chain);
      results[chain] = {
        status: "wallet_created",
        curve: wallet.curve,
        mode: wallet.mode,
        addresses: wallet.addresses,
        publicKeyHex: wallet.publicKeyHex.slice(0, 16) + "…",
        signingCapability: capabilityForChain(chain),
        note: "Send funds to address, then POST /native/sign/" + chainSlug(chain),
      };
    } catch (err) {
      results[chain] = { status: "error", error: String(err) };
    }
  }

  res.json({
    message: "Native Ika multi-chain wallets created (no Wormhole bridge)",
    ikaNetwork: "pre-alpha-dev-1.ika.ika-network.net:443",
    chains: results,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function loadWallet(id: number, expectedChain: SupportedChain): Promise<MultiChainWallet> {
  const [row] = await db
    .select()
    .from(nativeWalletsTable)
    .where(eq(nativeWalletsTable.id, id))
    .limit(1);

  if (!row) throw new Error(`Native wallet id=${id} not found`);
  if (row.chain !== expectedChain) {
    throw new Error(`Wallet id=${id} is ${row.chain}, expected ${expectedChain}`);
  }

  const dwalletInfo: MultichainDWalletResult = {
    publicKey: new Uint8Array(Buffer.from(row.publicKeyHex!, "hex")),
    publicOutput: new Uint8Array(Buffer.from(row.attestationHex ?? "00", "hex")),
    attestationData: new Uint8Array(Buffer.from(row.attestationHex ?? "00", "hex")),
    networkSignature: new Uint8Array(Buffer.from(row.networkSigHex ?? "00".repeat(64), "hex")),
    networkPubkey: new Uint8Array(Buffer.from(row.networkPubkeyHex ?? "00".repeat(32), "hex")),
    curve: row.curve as "secp256k1" | "secp256r1" | "curve25519" | "ristretto",
    mode: row.mode as "devnet" | "sim",
  };

  return {
    dwalletInfo,
    addresses: {
      eth: row.ethAddress ?? undefined,
      btc: row.btcAddress ?? undefined,
      sol: row.solAddress ?? undefined,
    },
    publicKeyHex: row.publicKeyHex!,
    chain: row.chain as SupportedChain,
    curve: row.curve as "secp256k1",
    mode: row.mode as "devnet" | "sim",
  };
}

function capabilityForChain(chain: SupportedChain) {
  const map: Record<SupportedChain, object> = {
    ethereum: { curve: "Secp256k1", sigScheme: "EcdsaKeccak256", network: "Sepolia" },
    bitcoin: { curve: "Secp256k1", sigScheme: "EcdsaDoubleSha256 / TaprootSha256", network: "Testnet3" },
    solana: { curve: "Curve25519", sigScheme: "EddsaSha512", network: "Devnet" },
    polkadot: { curve: "Ristretto", sigScheme: "SchnorrkelMerlin", network: "Westend" },
  };
  return map[chain];
}

function chainSlug(chain: SupportedChain): string {
  return chain === "ethereum" ? "eth" : chain === "bitcoin" ? "btc" : chain === "solana" ? "sol" : chain;
}

export default router;
