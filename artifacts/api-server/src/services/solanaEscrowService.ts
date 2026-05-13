/**
 * Solana Escrow Service — Devnet SOL Escrow via Sentinel Keypair
 *
 * Program ID (Anchor): GJbT5jcR38MzkmsCDrVWrjq2Bvg961CUkMnvUq7naqmq
 * Deployer keypair acts as the sentinel / escrow holder.
 *
 * Since the Anchor program's full IDL is not yet available in this codebase,
 * escrow logic uses the deployer's keypair as a on-chain SOL holder:
 *   1. User sends SOL to deployer pubkey (escrow)
 *   2. Sentinel releases SOL to solver via SystemProgram.transfer
 *   3. Sentinel refunds SOL to user via SystemProgram.transfer
 *
 * When the Anchor IDL is published, this can be switched to CPI calls.
 */

import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  Connection,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const SOLANA_DEVNET_RPC = process.env.SOLANA_DEVNET_RPC ?? "https://api.devnet.solana.com";
const SOLANA_ESCROW_PROGRAM_ID = "GJbT5jcR38MzkmsCDrVWrjq2Bvg961CUkMnvUq7naqmq";

// Deployer keypair (acts as sentinel / escrow holder)
// Provided by contract deployer — this keypair deployed the Anchor program
const DEPLOYER_SECRET_KEY: number[] = [
  107, 71, 178, 213, 215, 125, 235, 84, 162, 72, 85, 17, 247, 181, 99, 40,
  60, 139, 105, 57, 74, 242, 204, 63, 208, 219, 58, 173, 159, 82, 210, 169,
  234, 197, 46, 140, 89, 101, 151, 16, 183, 37, 203, 53, 253, 129, 140, 12,
  169, 217, 80, 202, 8, 57, 39, 138, 181, 219, 233, 26, 39, 93, 210, 109,
];

// ─── Cache ────────────────────────────────────────────────────────────────────
let _connection: Connection | null = null;
let _sentinelKeypair: Keypair | null = null;

function getConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(SOLANA_DEVNET_RPC, "confirmed");
  }
  return _connection;
}

function getSentinelKeypair(): Keypair {
  if (!_sentinelKeypair) {
    _sentinelKeypair = Keypair.fromSecretKey(new Uint8Array(DEPLOYER_SECRET_KEY));
    console.log(
      `[SolanaEscrow] Sentinel loaded from deployer keypair — pubkey=${_sentinelKeypair.publicKey.toBase58()}`
    );
  }
  return _sentinelKeypair;
}

// ─── Public API ────────────────────────────────────────────────────────────────

export interface SolanaEscrowIntent {
  intentId: number;
  user: string;
  solver: string;
  amount: string; // in SOL
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  status: number; // 0=open, 1=locked, 2=settled, 3=refunded, 4=disputed
  deliveryTxHash: string;
  proofHash: string;
}

/**
 * Derive a deterministic escrow PDA-compatible address per intent.
 * (Mirrors the Anchor program's expected PDA derivation.)
 */
function deriveIntentAddress(intentId: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), Buffer.from(intentId.toString())],
    new PublicKey(SOLANA_ESCROW_PROGRAM_ID),
  )[0];
}

/**
 * Get sentinel's SOL address (users send SOL here to lock escrow).
 */
export function getSolanaEscrowSentinelAddress(): string {
  return getSentinelKeypair().publicKey.toBase58();
}

/**
 * Check sentinel balance (escrow SOL available).
 */
export async function getSentinelBalance(): Promise<number> {
  const conn = getConnection();
  const bal = await conn.getBalance(getSentinelKeypair().publicKey);
  return bal / LAMPORTS_PER_SOL;
}

/**
 * Release SOL from sentinel to solver. Called after delivery proof verified.
 * Uses REAL SystemProgram.transfer on Solana devnet.
 */
export async function settleSolanaEscrow(
  intentId: number,
  solverAddress: string,
  amountLamports: number,
): Promise<{ txHash: string; explorerUrl: string } | { error: string }> {
  const conn = getConnection();
  const sentinel = getSentinelKeypair();

  try {
    const solverPubkey = new PublicKey(solverAddress);
    const balance = await conn.getBalance(sentinel.publicKey);

    if (balance < amountLamports + 5000) {
      return {
        error: `Sentinel balance insufficient: ${balance / LAMPORTS_PER_SOL} SOL (need ${amountLamports / LAMPORTS_PER_SOL} SOL + fee)`,
      };
    }

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const tx = new Transaction({ feePayer: sentinel.publicKey });
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.add(
      SystemProgram.transfer({
        fromPubkey: sentinel.publicKey,
        toPubkey: solverPubkey,
        lamports: amountLamports,
      }),
    );

    const sig = await sendAndConfirmTransaction(conn, tx, [sentinel], {
      commitment: "confirmed",
      maxRetries: 3,
    });

    console.log(
      `[SolanaEscrow] Settle #${intentId} — ${amountLamports / LAMPORTS_PER_SOL} SOL → ${solverAddress.slice(0, 12)}… tx=${sig.slice(0, 16)}…`
    );

    return {
      txHash: sig,
      explorerUrl: `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[SolanaEscrow] settle #${intentId} failed:`, msg);
    return { error: msg.slice(0, 200) };
  }
}

/**
 * Refund SOL from sentinel back to user.
 */
export async function refundSolanaEscrow(
  intentId: number,
  userAddress: string,
  amountLamports: number,
): Promise<{ txHash: string; explorerUrl: string } | { error: string }> {
  const conn = getConnection();
  const sentinel = getSentinelKeypair();

  try {
    const userPubkey = new PublicKey(userAddress);
    const balance = await conn.getBalance(sentinel.publicKey);

    if (balance < amountLamports + 5000) {
      return {
        error: `Sentinel balance insufficient: ${balance / LAMPORTS_PER_SOL} SOL`,
      };
    }

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const tx = new Transaction({ feePayer: sentinel.publicKey });
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.add(
      SystemProgram.transfer({
        fromPubkey: sentinel.publicKey,
        toPubkey: userPubkey,
        lamports: amountLamports,
      }),
    );

    const sig = await sendAndConfirmTransaction(conn, tx, [sentinel], {
      commitment: "confirmed",
      maxRetries: 3,
    });

    console.log(
      `[SolanaEscrow] Refund #${intentId} — ${amountLamports / LAMPORTS_PER_SOL} SOL → ${userAddress.slice(0, 12)}… tx=${sig.slice(0, 16)}…`
    );

    return {
      txHash: sig,
      explorerUrl: `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[SolanaEscrow] refund #${intentId} failed:`, msg);
    return { error: msg.slice(0, 200) };
  }
}

export { SOLANA_ESCROW_PROGRAM_ID };