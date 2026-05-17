/**
 * SOL Escrow Program ID
 *
 * Private-Intent on-chain escrow — Anchor PDA program.
 *
 * Source:   artifacts/sol-escrow/programs/private_intent_escrow/src/lib.rs
 * Build:    anchor build  (inside artifacts/sol-escrow/)
 * Deploy:   anchor deploy --provider.cluster devnet
 *
 * Instruction ABI (Anchor discriminator format):
 *   deposit(intent_id: u64, deadline: i64, amount: u64)
 *     disc = sha256("global:deposit")[0:8] = f2 23 c6 89 52 e1 f2 b6
 *   release(intent_id: u64, solver: Pubkey)
 *     disc = sha256("global:release")[0:8] = fd f9 0f ce 1c 7f c1 f1
 *   refund(intent_id: u64)
 *     disc = sha256("global:refund")[0:8] = 02 60 b7 fb 3f d0 2e 2e
 *
 * PDA derivation:
 *   seeds = [Buffer.from("escrow"), intentIdBuf_u64_LE]
 *   PublicKey.findProgramAddressSync(seeds, new PublicKey(SOL_ESCROW_PROGRAM_ID))
 *
 * When SOL_ESCROW_PROGRAM_ID env var is set it takes precedence (CI / local validator).
 */

export const SOL_ESCROW_PROGRAM_ID: string =
  process.env.SOL_ESCROW_PROGRAM_ID ??
  "GJbT5jcR38MzkmsCDrVWrjq2Bvg961CUkMnvUq7naqmq";

export const SOL_ESCROW_PDA_SEED = "escrow";

/**
 * On-chain operator authority that the Anchor program authorizes for `release`.
 * Must equal getSentinelKeypair().publicKey.toBase58() at runtime.
 * Override via SOL_ESCROW_OPERATOR env var if you rotate the operator key.
 */
export const SOL_ESCROW_OPERATOR: string =
  process.env.SOL_ESCROW_OPERATOR ??
  "9xPwjf2dmafdxhnyZeAaVQpYWxH4Kn1N9XeeLQpnkttu";