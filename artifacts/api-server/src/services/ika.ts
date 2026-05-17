/**
 * Ika dWallet Service — Real Integration (No Simulation Fallback)
 *
 * Connects to Ika pre-alpha devnet via gRPC.
 * Performs real DKG + MPC co-signing. THROWS on failure — no sim fallback.
 *
 * Network: pre-alpha-dev-1.ika.ika-network.net:443
 * SDK: @ika.xyz/pre-alpha-solana-client (gRPC/grpc-js)
 */
import { createHash } from "crypto";

export interface DWalletInfo {
  dwalletId: string;
  capId: string;
  publicKey: string;
  network: string;
  mode: "devnet";
  attestation?: string;
}

export interface CoSignResult {
  coSigned: boolean;
  signature?: string;
  reason?: string;
  mode: "devnet";
  network?: string;
  dkgAttested?: boolean;
}

export const IKA_GRPC_URL =
  process.env.IKA_GRPC_URL ?? "pre-alpha-dev-1.ika.ika-network.net:443";

export const IKA_DEVNET_PROGRAM_ID =
  process.env.IKA_PROGRAM_ID ?? "87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY";

export const SENTINEL_PUBKEY_HEX =
  process.env.SOLANA_DEVNET_PUBKEY ?? "99pdEHxysxtd6KhFQ6im6NRAX5hHUm3rpMNJSCjUjfBQ";

const SENTINEL_SECRET_ARRAY: number[] =
  process.env.SOLANA_SECRET_KEY_ARRAY
    ? JSON.parse(process.env.SOLANA_SECRET_KEY_ARRAY)
    : [41,207,57,28,251,41,171,142,252,160,63,134,75,115,226,251,46,36,103,2,26,173,240,172,52,216,59,177,26,245,180,57,121,31,253,193,176,197,254,126,65,138,29,13,208,252,28,130,59,154,64,240,65,27,70,182,194,15,93,44,5,212,3,115];

function getSentinelPubkeyBytes(): Uint8Array {
  if (SENTINEL_SECRET_ARRAY.length < 64) {
    throw new Error("SOLANA_SECRET_KEY_ARRAY must be 64 bytes (Ed25519 keypair).");
  }
  return new Uint8Array(SENTINEL_SECRET_ARRAY.slice(32, 64));
}

function getSentinelSecretKey(): Uint8Array {
  return new Uint8Array(SENTINEL_SECRET_ARRAY);
}

type IkaClient = {
  requestDKG(senderPubkey: Uint8Array): Promise<{
    publicKey: Uint8Array;
    attestationData: Uint8Array;
    networkSignature: Uint8Array;
    networkPubkey: Uint8Array;
    publicOutput?: Uint8Array;
  }>;
  requestPresign(senderPubkey: Uint8Array, dwalletAddr: Uint8Array): Promise<Uint8Array>;
  requestSign(
    senderPubkey: Uint8Array,
    dwalletAddr: Uint8Array,
    message: Uint8Array,
    presignId: Uint8Array,
    txSignature: Uint8Array,
  ): Promise<Uint8Array>;
  close(): void;
};

let _ikaClient: IkaClient | null = null;

async function getIkaClient(): Promise<IkaClient> {
  if (_ikaClient) return _ikaClient;
  const IkaGrpc = await import("@ika.xyz/pre-alpha-solana-client/grpc") as unknown as (url: string) => IkaClient;
  _ikaClient = IkaGrpc(IKA_GRPC_URL) as IkaClient;
  return _ikaClient;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Ika gRPC timeout after ${ms}ms`)), ms),
    ),
  ]);
}

function grpcErrorDetail(err: unknown): string {
  if (err instanceof Error) {
    const e = err as Error & { code?: number; details?: string };
    return [e.message, e.code !== undefined ? `code=${e.code}` : "", e.details ?? ""]
      .filter(Boolean).join(" | ");
  }
  return String(err);
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number },
): Promise<T> {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await fn();
    } catch (err) {
      const msg = grpcErrorDetail(err);
      const isLast = opts.maxAttempts > 0 && attempt >= opts.maxAttempts;
      process.stderr.write(`[Ika] ${label} attempt ${attempt}${opts.maxAttempts > 0 ? `/${opts.maxAttempts}` : ""} FAILED: ${msg}\n`);
      if (isLast) throw new Error(`[Ika] ${label} failed after ${attempt} attempts. Last: ${msg}`);
      const delay = Math.min(opts.baseDelayMs * Math.pow(1.5, attempt - 1), opts.maxDelayMs);
      process.stderr.write(`[Ika] ${label} retrying in ${Math.round(delay)}ms…\n`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

/**
 * Create a new dWallet via Ika DKG on devnet.
 * Retries up to 8 times. THROWS on exhaustion — no simulation fallback.
 */
export async function createDWallet(walletAddress: string): Promise<DWalletInfo> {
  const senderPubkey = getSentinelPubkeyBytes();

  const result = await withRetry(
    "DKG",
    async () => {
      const client = await getIkaClient();
      return withTimeout(client.requestDKG(senderPubkey), 35_000);
    },
    { maxAttempts: 8, baseDelayMs: 2_000, maxDelayMs: 15_000 },
  );

  const publicKeyHex = Buffer.from(result.publicKey).toString("hex");
  const attestationHex = Buffer.from(result.attestationData).toString("hex");
  const dwalletId = `ika:${publicKeyHex.slice(0, 40)}`;
  const capId = `ika:cap:${Buffer.from(result.networkPubkey).toString("hex").slice(0, 32)}`;

  process.stdout.write(
    `[Ika] DKG success — publicKey=${publicKeyHex.slice(0, 16)}… wallet=${walletAddress}\n`,
  );

  return {
    dwalletId,
    capId,
    publicKey: publicKeyHex,
    network: IKA_GRPC_URL,
    mode: "devnet",
    attestation: attestationHex.slice(0, 64),
  };
}

/**
 * Request Ika MPC co-signature for a transaction.
 * Policy violations immediately return coSigned=false (no network call).
 * All network steps retry on failure. THROWS if network is unreachable.
 */
export async function requestCoSignature(
  dwalletId: string,
  txDigest: string,
  policyCheck: boolean,
): Promise<CoSignResult> {
  if (!policyCheck) {
    return {
      coSigned: false,
      reason: "Policy violation — Ika MPC co-signature denied by PrismDwallet policy engine",
      mode: "devnet",
      network: IKA_GRPC_URL,
      dkgAttested: false,
    };
  }

  const senderPubkey = getSentinelPubkeyBytes();
  const message = Buffer.from(createHash("sha256").update(txDigest).digest());

  // Step 1: DKG
  const dkgResult = await withRetry(
    "DKG(cosign)",
    async () => {
      const client = await getIkaClient();
      return withTimeout(client.requestDKG(senderPubkey), 35_000);
    },
    { maxAttempts: 8, baseDelayMs: 2_000, maxDelayMs: 15_000 },
  );

  const dwalletPublicKey = dkgResult.publicKey;
  process.stdout.write(
    `[Ika] DKG OK — pubkey=${Buffer.from(dwalletPublicKey).toString("hex").slice(0, 16)}…\n`,
  );

  // Step 2: Presign
  const presignId = await withRetry(
    "Presign",
    async () => {
      const client = await getIkaClient();
      return withTimeout(client.requestPresign(senderPubkey, dwalletPublicKey), 30_000);
    },
    { maxAttempts: 6, baseDelayMs: 2_000, maxDelayMs: 12_000 },
  );
  process.stdout.write(
    `[Ika] Presign OK — presignId=${Buffer.from(presignId).toString("hex").slice(0, 16)}…\n`,
  );

  // Step 3: Sign
  const txSignature = getSentinelSecretKey().slice(0, 64);
  const mpcSig = await withRetry(
    "Sign",
    async () => {
      const client = await getIkaClient();
      return withTimeout(
        client.requestSign(
          senderPubkey,
          dwalletPublicKey,
          new Uint8Array(message),
          presignId,
          new Uint8Array(txSignature),
        ),
        30_000,
      );
    },
    { maxAttempts: 6, baseDelayMs: 2_000, maxDelayMs: 12_000 },
  );

  const sigHex = Buffer.from(mpcSig).toString("hex");
  process.stdout.write(`[Ika] Co-sign OK — sig=${sigHex.slice(0, 16)}…\n`);

  return {
    coSigned: true,
    signature: sigHex,
    mode: "devnet",
    network: IKA_GRPC_URL,
    dkgAttested: true,
  };
}

/**
 * Get an Ika MPC signature over raw bytes (e.g., Solana tx message).
 * Retries on failure. THROWS if network is unreachable.
 */
export async function getIkaMpcSignature(
  dwalletPublicKeyHex: string,
  messageBytes: Uint8Array,
): Promise<{ signature: Uint8Array; mode: "devnet" }> {
  const senderPubkey = getSentinelPubkeyBytes();
  const dwalletPublicKey = new Uint8Array(Buffer.from(dwalletPublicKeyHex, "hex"));

  const presignId = await withRetry(
    "Presign(mpc-sig)",
    async () => {
      const client = await getIkaClient();
      return withTimeout(client.requestPresign(senderPubkey, dwalletPublicKey), 30_000);
    },
    { maxAttempts: 6, baseDelayMs: 2_000, maxDelayMs: 12_000 },
  );
  process.stdout.write(
    `[Ika] Presign OK — presignId=${Buffer.from(presignId).toString("hex").slice(0, 16)}…\n`,
  );

  const txSignature = new Uint8Array(getSentinelSecretKey().slice(0, 64));
  const mpcSig = await withRetry(
    "Sign(mpc-sig)",
    async () => {
      const client = await getIkaClient();
      return withTimeout(
        client.requestSign(senderPubkey, dwalletPublicKey, messageBytes, presignId, txSignature),
        30_000,
      );
    },
    { maxAttempts: 6, baseDelayMs: 2_000, maxDelayMs: 12_000 },
  );

  process.stdout.write(
    `[Ika] MPC signature OK — sig=${Buffer.from(mpcSig).toString("hex").slice(0, 16)}… len=${mpcSig.length}\n`,
  );

  return { signature: new Uint8Array(mpcSig), mode: "devnet" };
}
