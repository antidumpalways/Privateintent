/**
 * Solana Devnet Broadcast Service
 *
 * Takes the Ika MPC co-signature + Encrypt FHE onChainId and broadcasts a
 * REAL Solana devnet transaction containing the swap intent commitment.
 *
 * This is what makes PrismDwallet's execution end-to-end on-chain:
 *   1. Encrypt FHE devnet stores the encrypted intent (onChainId)
 *   2. Ika devnet returns MPC threshold signature
 *   3. THIS SERVICE: builds a Solana memo tx with intentHash + ikaSig + encryptId,
 *      signs with the sentinel keypair, and submits to Solana devnet RPC.
 *
 * The returned signature is a real, verifiable Solana devnet transaction.
 * Anyone can verify it on https://explorer.solana.com/?cluster=devnet
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { existsSync, readFileSync, writeFileSync } from "fs";

const SOLANA_DEVNET_RPC =
  process.env.SOLANA_DEVNET_RPC ?? "https://api.devnet.solana.com";

// Solana official Memo program — works on every cluster, no SOL needed
// beyond the base tx fee (~0.000005 SOL).
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

// Persist a per-environment ephemeral keypair. NEVER hardcode secrets.
// Order of precedence:
//   1. SOLANA_SECRET_KEY_ARRAY env var (JSON array of 64 bytes) — operator-supplied
//   2. /tmp/prism-sentinel-keypair.json — persisted ephemeral keypair across restarts
//   3. Generate fresh keypair, persist it, surface the pubkey in logs for funding
const SENTINEL_KEYPAIR_PATH = "/tmp/prism-sentinel-keypair.json";

let _connection: Connection | null = null;
function getConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(SOLANA_DEVNET_RPC, "confirmed");
  }
  return _connection;
}

let _payer: Keypair | null = null;
function getPayer(): Keypair {
  if (_payer) return _payer;

  // 1. Operator-supplied env var (production / staging)
  if (process.env.SOLANA_SECRET_KEY_ARRAY) {
    try {
      const arr = JSON.parse(process.env.SOLANA_SECRET_KEY_ARRAY) as number[];
      if (Array.isArray(arr) && arr.length === 64) {
        _payer = Keypair.fromSecretKey(new Uint8Array(arr));
        process.stdout.write(
          `[Solana] Sentinel keypair loaded from env — pubkey=${_payer.publicKey.toBase58()}\n`,
        );
        return _payer;
      }
    } catch {
      /* fall through */
    }
  }

  // 2. Persisted ephemeral keypair (survives server restarts within the same env)
  if (existsSync(SENTINEL_KEYPAIR_PATH)) {
    try {
      const arr = JSON.parse(readFileSync(SENTINEL_KEYPAIR_PATH, "utf8")) as number[];
      if (Array.isArray(arr) && arr.length === 64) {
        _payer = Keypair.fromSecretKey(new Uint8Array(arr));
        process.stdout.write(
          `[Solana] Sentinel keypair loaded from ${SENTINEL_KEYPAIR_PATH} — pubkey=${_payer.publicKey.toBase58()}\n`,
        );
        return _payer;
      }
    } catch {
      /* fall through to fresh generation */
    }
  }

  // 3. Fresh ephemeral keypair — generate, persist, log for manual funding
  _payer = Keypair.generate();
  try {
    writeFileSync(
      SENTINEL_KEYPAIR_PATH,
      JSON.stringify(Array.from(_payer.secretKey)),
      { mode: 0o600 },
    );
  } catch {
    /* persistence failure is non-fatal */
  }
  process.stdout.write(
    `[Solana] Generated FRESH sentinel keypair — pubkey=${_payer.publicKey.toBase58()}\n`,
  );
  process.stdout.write(
    `[Solana] Fund it with devnet SOL at https://faucet.solana.com (paste address: ${_payer.publicKey.toBase58()})\n`,
  );
  return _payer;
}

export interface SolanaBroadcastResult {
  broadcast: boolean;
  signature?: string;
  explorerUrl?: string;
  slot?: number;
  network: string;
  payer: string;
  reason?: string;
}

export interface BroadcastIntent {
  intentHash: string;
  encryptOnChainId?: string;
  ikaSignature: string;
  ikaDkgAttested: boolean;
  dwalletId: string;
  fromToken: string;
  toToken: string;
  amount: string;
}

/**
 * Build the on-chain memo payload binding all three primitives:
 * Encrypt FHE intent commitment + Ika MPC signature + LI.FI route digest.
 *
 * Format (versioned, parseable by anyone reading the tx on Explorer):
 *   prism:v1|hash=<16hex>|ika=<16hex>|att=<bool>|enc=<20hex>|dw=<16hex>|<from>:<amt>:<to>
 */
function buildMemoPayload(intent: BroadcastIntent): string {
  const ikaShort = intent.ikaSignature.slice(0, 16);
  const intentShort = intent.intentHash.slice(0, 16);
  const dwShort = intent.dwalletId.replace(/^ika:/, "").slice(0, 16);
  const encShort = (intent.encryptOnChainId ?? "")
    .replace(/^encrypt:/, "")
    .slice(0, 20);
  return [
    "prism:v1",
    `hash=${intentShort}`,
    `ika=${ikaShort}`,
    `att=${intent.ikaDkgAttested}`,
    `enc=${encShort}`,
    `dw=${dwShort}`,
    `${intent.fromToken}:${intent.amount}:${intent.toToken}`,
  ].join("|");
}

/**
 * Broadcast the swap intent commitment to Solana devnet as a memo transaction.
 *
 * Returns the real devnet signature. Verifiable on Solana Explorer.
 * Falls back to `broadcast: false` with a reason if the RPC is unreachable
 * or the payer has no SOL — never fakes the signature.
 */
export async function broadcastIntentToSolana(
  intent: BroadcastIntent,
): Promise<SolanaBroadcastResult> {
  const conn = getConnection();
  const payer = getPayer();

  const memo = buildMemoPayload(intent);
  const memoIx = new TransactionInstruction({
    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo, "utf8"),
  });

  try {
    // Verify payer has SOL — if 0, attempt one airdrop, then bail with clear instructions.
    let balance = await conn.getBalance(payer.publicKey);
    if (balance < 5_000) {
      try {
        process.stdout.write(
          `[Solana] Sentinel payer empty (${payer.publicKey.toBase58()}) — attempting devnet airdrop…\n`,
        );
        // Try 0.1 SOL — small enough that the devnet faucet is more likely to honor it
        const airdropSig = await conn.requestAirdrop(payer.publicKey, 100_000_000);
        await conn.confirmTransaction(airdropSig, "confirmed");
        balance = await conn.getBalance(payer.publicKey);
        process.stdout.write(
          `[Solana] Airdrop confirmed — balance=${balance} lamports sig=${airdropSig.slice(0, 16)}…\n`,
        );
      } catch (airdropErr) {
        const m = airdropErr instanceof Error ? airdropErr.message : String(airdropErr);
        // Faucet rate-limited or dry — return a clear actionable error
        return {
          broadcast: false,
          network: SOLANA_DEVNET_RPC,
          payer: payer.publicKey.toBase58(),
          reason: `Devnet airdrop failed (${m.slice(0, 80)}). Fund manually at https://faucet.solana.com (paste address: ${payer.publicKey.toBase58()}) — broadcast will work on next call.`,
        };
      }
    }
    if (balance < 5_000) {
      return {
        broadcast: false,
        network: SOLANA_DEVNET_RPC,
        payer: payer.publicKey.toBase58(),
        reason: `Insufficient SOL after airdrop attempt (${balance} lamports). Fund manually at https://faucet.solana.com (paste address: ${payer.publicKey.toBase58()}).`,
      };
    }

    const tx = new Transaction().add(memoIx);
    tx.feePayer = payer.publicKey;
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;

    const signature = await sendAndConfirmTransaction(conn, tx, [payer], {
      commitment: "confirmed",
      maxRetries: 3,
    });

    const status = await conn.getSignatureStatus(signature);
    const slot = status?.value?.slot;

    process.stdout.write(
      `[Solana] Devnet broadcast confirmed — sig=${signature.slice(0, 16)}… slot=${slot}\n`,
    );

    return {
      broadcast: true,
      signature,
      explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
      slot,
      network: SOLANA_DEVNET_RPC,
      payer: payer.publicKey.toBase58(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[Solana] Broadcast failed: ${msg}\n`);
    return {
      broadcast: false,
      network: SOLANA_DEVNET_RPC,
      payer: payer.publicKey.toBase58(),
      reason: msg.slice(0, 200),
    };
  }
}

export { SOLANA_DEVNET_RPC };

/**
 * Expose the sentinel keypair to other services (e.g., Wormhole bridge)
 * that need to sign Solana devnet transactions on the server side.
 *
 * Same precedence rules apply (env var → persisted file → ephemeral).
 */
export function getSentinelKeypair(): Keypair {
  return getPayer();
}
