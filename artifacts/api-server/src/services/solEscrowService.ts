/**
 * SOL Intent Escrow Service
 *
 * Manages per-intent SOL escrow accounts on Solana devnet using the Anchor
 * PDA escrow program at GJbT5jcR38MzkmsCDrVWrjq2Bvg961CUkMnvUq7naqmq.
 *
 * ── Architecture ─────────────────────────────────────────────────────────────
 *
 * Program:   contracts/sol-escrow (Anchor, lib.rs)
 * Program ID: GJbT5jcR38MzkmsCDrVWrjq2Bvg961CUkMnvUq7naqmq
 * PDA seeds:  ["escrow", intentId as u64 LE]  — one PDA per intent
 *
 * Instructions (Anchor discriminator format):
 *   deposit(intent_id, deadline, amount)  — user-signed via Phantom
 *   release(intent_id, solver)            — operator-signed by sentinel keypair
 *   refund(intent_id)                     — depositor-signed via Phantom post-deadline
 *
 * Discriminators (sha256("global:<name>")[0:8]):
 *   deposit: f2 23 c6 89 52 e1 f2 b6
 *   release: fd f9 0f ce 1c 7f c1 f1
 *   refund:  02 60 b7 fb 3f d0 2e 2e
 *
 * Account layout per instruction (matches Anchor struct field order):
 *   deposit: [escrow_account PDA (init,writable), depositor (signer,writable), system_program]
 *   release: [escrow_account PDA (writable), operator (signer,writable), solver_account (writable)]
 *   refund:  [escrow_account PDA (writable), depositor (signer,writable)]
 *
 * ── Mode ─────────────────────────────────────────────────────────────────────
 *
 * This service is PDA-only. The program at GJbT5j… must be deployed on devnet.
 * There is no keypair fallback — if the program is not deployed, operations
 * will fail with a clear on-chain error rather than silently falling back to
 * EOA-style custody.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getSentinelKeypair, SOLANA_DEVNET_RPC } from "./solanaBroadcast.js";
import { SOL_ESCROW_PROGRAM_ID, SOL_ESCROW_PDA_SEED } from "./solEscrowProgramId.js";

export interface SolEscrowReleaseResult {
  success: boolean;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
  mode?: string;
}

// ── PDA helpers ────────────────────────────────────────────────────────────

/** Derive the escrow PDA for a given intentId. seeds = ["escrow", intentId u64 LE] */
export function getSolEscrowPda(intentId: number): PublicKey {
  const intentBuf = Buffer.alloc(8);
  intentBuf.writeBigUInt64LE(BigInt(intentId), 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(SOL_ESCROW_PDA_SEED), intentBuf],
    new PublicKey(SOL_ESCROW_PROGRAM_ID),
  );
  return pda;
}

/** Derive escrow PDA and return the bump byte. */
export function getSolEscrowPdaWithBump(intentId: number): [PublicKey, number] {
  const intentBuf = Buffer.alloc(8);
  intentBuf.writeBigUInt64LE(BigInt(intentId), 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SOL_ESCROW_PDA_SEED), intentBuf],
    new PublicKey(SOL_ESCROW_PROGRAM_ID),
  );
}

// ── Public address API ─────────────────────────────────────────────────────

/**
 * Return the base58 address of the per-intent escrow PDA.
 * This is always program-owned — no EOA keypair fallback.
 */
export function getSolIntentEscrowAddress(intentId: number): string {
  return getSolEscrowPda(intentId).toBase58();
}

// ── Startup program check ──────────────────────────────────────────────────

/**
 * Verify the Solana escrow program is deployed on devnet.
 * Call this on server startup — logs a clear warning if the program is missing
 * so SOL→ETH release failures are diagnosable immediately.
 */
export async function verifySolEscrowProgram(): Promise<void> {
  try {
    const conn = new Connection(SOLANA_DEVNET_RPC, "confirmed");
    const programId = new PublicKey(SOL_ESCROW_PROGRAM_ID);
    const info = await conn.getAccountInfo(programId, "confirmed");
    if (!info) {
      process.stderr.write(
        `[SolEscrow] ⚠️  WARN: Program ${SOL_ESCROW_PROGRAM_ID} NOT FOUND on devnet — SOL→ETH releaseSolEscrow() will fail\n`,
      );
    } else if (!info.executable) {
      process.stderr.write(
        `[SolEscrow] ⚠️  WARN: Account ${SOL_ESCROW_PROGRAM_ID} exists but is NOT executable — check deployment\n`,
      );
    } else {
      process.stdout.write(
        `[SolEscrow] ✓ Program deployed on devnet — ${SOL_ESCROW_PROGRAM_ID.slice(0, 8)}… (SOL→ETH release ready)\n`,
      );
    }
  } catch (e) {
    process.stderr.write(`[SolEscrow] startup check failed: ${(e as Error).message?.slice(0, 80)}\n`);
  }
}

// ── Release (operator-signed) ──────────────────────────────────────────────

/**
 * Send the Anchor `release` instruction to transfer SOL from the per-intent
 * PDA to the solver. Signed by the operator sentinel keypair.
 *
 * disc = sha256("global:release")[0:8] = fd f9 0f ce 1c 7f c1 f1
 * args: intent_id u64 LE (8) | solver Pubkey (32)
 * accounts: [escrow_account PDA (writable), operator (signer,writable), solver_account (writable)]
 */
export async function releaseSolEscrow(
  intentId: number,
  solverAddress: string,
): Promise<SolEscrowReleaseResult> {
  const sentinel = getSentinelKeypair();
  const programId = new PublicKey(SOL_ESCROW_PROGRAM_ID);
  const escrowPda = getSolEscrowPda(intentId);
  const conn = new Connection(SOLANA_DEVNET_RPC, "confirmed");

  let solverPubkey: PublicKey;
  try {
    solverPubkey = new PublicKey(solverAddress);
  } catch {
    return { success: false, error: `Invalid solver address: ${solverAddress}`, mode: "pda" };
  }

  let balance: number;
  try {
    balance = await conn.getBalance(escrowPda, "confirmed");
  } catch (e) {
    return { success: false, error: `getBalance failed: ${(e as Error).message?.slice(0, 80)}`, mode: "pda" };
  }

  if (balance === 0) {
    // Zero balance is treated as an idempotent success — the escrow was either
    // never funded (solver shouldn't have been paid) or already drained by a prior
    // release. Callers should log this state but must NOT mark the intent
    // release_failed; treating it as a failure would cause false retry loops.
    process.stdout.write(
      `[SolEscrow] release intentId=${intentId} escrow=${escrowPda.toBase58().slice(0, 8)}… balance=0 — already released or unfunded (idempotent ok)\n`,
    );
    return {
      success: true,
      txHash: undefined,
      mode: "already_released_or_empty",
    };
  }

  // Anchor `release` discriminator + borsh args
  const RELEASE_DISC = Buffer.from([0xfd, 0xf9, 0x0f, 0xce, 0x1c, 0x7f, 0xc1, 0xf1]);
  const intentBuf = Buffer.alloc(8);
  intentBuf.writeBigUInt64LE(BigInt(intentId), 0);
  const solverBytes = Buffer.from(solverPubkey.toBytes()); // 32 bytes

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: escrowPda,          isSigner: false, isWritable: true  }, // [0] escrow_account
      { pubkey: sentinel.publicKey, isSigner: true,  isWritable: true  }, // [1] operator
      { pubkey: solverPubkey,       isSigner: false, isWritable: true  }, // [2] solver_account
    ],
    data: Buffer.concat([RELEASE_DISC, intentBuf, solverBytes]),
  });

  try {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: sentinel.publicKey }).add(ix);
    tx.lastValidBlockHeight = lastValidBlockHeight;
    const sig = await sendAndConfirmTransaction(conn, tx, [sentinel], { commitment: "confirmed" });
    process.stdout.write(
      `[SolEscrow] RELEASED intentId=${intentId} escrow=${escrowPda.toBase58().slice(0, 8)}… solver=${solverAddress.slice(0, 8)}… sig=${sig.slice(0, 16)}…\n`,
    );
    return {
      success: true,
      txHash: sig,
      explorerUrl: `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
      mode: "pda",
    };
  } catch (e) {
    const msg = (e as Error).message?.slice(0, 120);
    process.stderr.write(`[SolEscrow] release FAILED intentId=${intentId}: ${msg}\n`);
    return { success: false, error: msg, mode: "pda" };
  }
}

// ── Refund instruction data (depositor-signed from frontend) ──────────────

/**
 * Build the serialized Anchor `refund` instruction data.
 * The instruction must be signed by the original depositor via their wallet
 * (Phantom). The API server cannot sign refunds — the on-chain program
 * requires `depositor` as a signer and validates `has_one = depositor`.
 *
 * disc = sha256("global:refund")[0:8] = 02 60 b7 fb 3f d0 2e 2e
 * args: intent_id u64 LE (8 bytes)
 * accounts: [escrow_account PDA (writable), depositor (signer,writable)]
 */
export function buildRefundInstructionParams(intentId: number): {
  programId: string;
  escrowPda: string;
  instructionDataHex: string;
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  note: string;
} {
  const REFUND_DISC = Buffer.from([0x02, 0x60, 0xb7, 0xfb, 0x3f, 0xd0, 0x2e, 0x2e]);
  const intentBuf = Buffer.alloc(8);
  intentBuf.writeBigUInt64LE(BigInt(intentId), 0);
  const data = Buffer.concat([REFUND_DISC, intentBuf]);
  const escrowPda = getSolEscrowPda(intentId).toBase58();

  return {
    programId: SOL_ESCROW_PROGRAM_ID,
    escrowPda,
    instructionDataHex: data.toString("hex"),
    accounts: [
      { pubkey: escrowPda, isSigner: false, isWritable: true  }, // [0] escrow_account PDA
      { pubkey: "DEPOSITOR_PUBKEY",  isSigner: true,  isWritable: true  }, // [1] depositor — frontend fills in
    ],
    note: "Replace DEPOSITOR_PUBKEY with the user wallet pubkey. Phantom signs this tx.",
  };
}
