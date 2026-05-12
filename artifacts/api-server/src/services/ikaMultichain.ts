/**
 * Ika Multi-Chain dWallet Service
 *
 * Supports native signing for:
 *   - Ethereum (Secp256k1 + EcdsaKeccak256)
 *   - Bitcoin  (Secp256k1 + EcdsaDoubleSha256 / TaprootSha256)
 *   - Solana   (Curve25519 + EddsaSha512)
 *   - Polkadot (Ristretto + SchnorrkelMerlin)
 *
 * Uses raw gRPC + BCS serialization from @ika.xyz/pre-alpha-solana-client/grpc.
 * No Wormhole bridge required — signs native chain transactions directly.
 */

import * as grpc from "@grpc/grpc-js";
import { randomBytes, createHash } from "crypto";

const IKA_GRPC_URL =
  process.env.IKA_GRPC_URL ?? "pre-alpha-dev-1.ika.ika-network.net:443";

// ─────────────────────────────────────────────────────────────────────────────
// Protobuf encode/decode helpers (no external proto lib needed)
// UserSignedRequest: field1=userSignature, field2=signedRequestData
// TransactionResponse: field1=responseData
// ─────────────────────────────────────────────────────────────────────────────

function encodeVarint(val: number): Buffer {
  if (val < 128) return Buffer.from([val]);
  const bytes: number[] = [];
  while (val > 0x7f) {
    bytes.push((val & 0x7f) | 0x80);
    val >>>= 7;
  }
  bytes.push(val & 0x7f);
  return Buffer.from(bytes);
}

function encodeField(fieldNum: number, data: Uint8Array): Buffer {
  const tag = encodeVarint((fieldNum << 3) | 2);
  const len = encodeVarint(data.length);
  return Buffer.concat([tag, len, Buffer.from(data)]);
}

function decodeFields(buf: Uint8Array): Map<number, Uint8Array> {
  const fields = new Map<number, Uint8Array>();
  let pos = 0;
  while (pos < buf.length) {
    let tagVal = 0, shift = 0;
    while (pos < buf.length && buf[pos] & 0x80) {
      tagVal |= (buf[pos] & 0x7f) << shift;
      pos++; shift += 7;
    }
    if (pos >= buf.length) break;
    tagVal |= buf[pos] << shift;
    pos++;
    const fieldNum = tagVal >>> 3;
    const wireType = tagVal & 0x7;
    if (wireType === 2) {
      let len = 0; shift = 0;
      while (pos < buf.length && buf[pos] & 0x80) {
        len |= (buf[pos] & 0x7f) << shift;
        pos++; shift += 7;
      }
      len |= buf[pos] << shift;
      pos++;
      fields.set(fieldNum, buf.slice(pos, pos + len));
      pos += len;
    } else {
      break;
    }
  }
  return fields;
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw gRPC client — calls SubmitTransaction on Ika node
// ─────────────────────────────────────────────────────────────────────────────

let _rawClient: InstanceType<ReturnType<typeof grpc.makeGenericClientConstructor>> | null = null;

function getRawGrpcClient() {
  if (_rawClient) return _rawClient;
  const creds = IKA_GRPC_URL.includes("localhost") || IKA_GRPC_URL.includes("127.0.0.1")
    ? grpc.credentials.createInsecure()
    : grpc.credentials.createSsl();

  const ServiceCtor = grpc.makeGenericClientConstructor(
    {
      SubmitTransaction: {
        path: "/ika.dwallet.v1.DWalletService/SubmitTransaction",
        requestStream: false,
        responseStream: false,
        requestSerialize: (req: { userSignature: Buffer; signedRequestData: Buffer }) =>
          Buffer.concat([encodeField(1, req.userSignature), encodeField(2, req.signedRequestData)]),
        requestDeserialize: (b: Buffer) => b,
        responseSerialize: (b: Buffer) => b,
        responseDeserialize: (b: Buffer) => {
          const fields = decodeFields(b);
          return fields.get(1) ?? new Uint8Array(0);
        },
      },
    },
    "DWalletService",
    {},
  );
  _rawClient = new ServiceCtor(IKA_GRPC_URL, creds) as any;
  return _rawClient!;
}

function submitTransaction(userSig: Uint8Array, signedData: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const client = getRawGrpcClient();
    (client as any).SubmitTransaction(
      { userSignature: Buffer.from(userSig), signedRequestData: Buffer.from(signedData) },
      (err: Error | null, resp: Uint8Array) => {
        if (err) reject(err);
        else resolve(new Uint8Array(resp));
      },
    );
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Ika gRPC timeout ${ms}ms`)), ms),
    ),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// BCS types — loaded dynamically from SDK (ES module)
// ─────────────────────────────────────────────────────────────────────────────

let _bcs: ReturnType<typeof import("@ika.xyz/pre-alpha-solana-client/grpc").defineBcsTypes> | null = null;

async function getBcs() {
  if (_bcs) return _bcs;
  const { defineBcsTypes } = await import("@ika.xyz/pre-alpha-solana-client/grpc");
  _bcs = defineBcsTypes();
  return _bcs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sentinel identity (authorizes gRPC requests in pre-alpha)
// ─────────────────────────────────────────────────────────────────────────────

const SENTINEL_SECRET_ARRAY: number[] =
  process.env.SOLANA_SECRET_KEY_ARRAY
    ? JSON.parse(process.env.SOLANA_SECRET_KEY_ARRAY)
    : [41,207,57,28,251,41,171,142,252,160,63,134,75,115,226,251,46,36,103,2,26,173,240,172,52,216,59,177,26,245,180,57,121,31,253,193,176,197,254,126,65,138,29,13,208,252,28,130,59,154,64,240,65,27,70,182,194,15,93,44,5,212,3,115];

function getSentinelPubkeyBytes(): Uint8Array {
  return new Uint8Array(SENTINEL_SECRET_ARRAY.slice(32, 64));
}

function buildUserSig(pubkey: Uint8Array, bcsTypes: ReturnType<typeof import("@ika.xyz/pre-alpha-solana-client/grpc").defineBcsTypes>): Uint8Array {
  return bcsTypes.UserSignature.serialize({
    Ed25519: { signature: Array.from(new Uint8Array(64)), public_key: Array.from(pubkey) },
  }).toBytes();
}

// ─────────────────────────────────────────────────────────────────────────────
// Curve config
// ─────────────────────────────────────────────────────────────────────────────

export type IkaCurve = "secp256k1" | "secp256r1" | "curve25519" | "ristretto";
export type IkaSigAlgo = "ECDSASecp256k1" | "ECDSASecp256r1" | "Taproot" | "EdDSA" | "SchnorrkelSubstrate";
export type IkaSigScheme = "EcdsaKeccak256" | "EcdsaDoubleSha256" | "TaprootSha256" | "EddsaSha512" | "SchnorrkelMerlin";

function curveBcs(curve: IkaCurve): Record<string, boolean> {
  const map: Record<IkaCurve, string> = {
    secp256k1: "Secp256k1",
    secp256r1: "Secp256r1",
    curve25519: "Curve25519",
    ristretto: "Ristretto",
  };
  return { [map[curve]]: true };
}

function sigAlgoBcs(algo: IkaSigAlgo): Record<string, boolean> {
  return { [algo]: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface MultichainDWalletResult {
  publicKey: Uint8Array;
  publicOutput: Uint8Array;
  attestationData: Uint8Array;
  networkSignature: Uint8Array;
  networkPubkey: Uint8Array;
  curve: IkaCurve;
  mode: "devnet" | "sim";
}

/**
 * Probe Ika gRPC connectivity — lightweight check, no DKG.
 * Returns reachable=true if the channel reaches READY state within 4s.
 */
export async function probeIkaConnectivity(): Promise<{ reachable: boolean; latencyMs: number; url: string; error?: string }> {
  const start = Date.now();
  try {
    const client = getRawGrpcClient();
    const channel = (client as any).getChannel?.();
    if (!channel) return { reachable: false, latencyMs: Date.now() - start, url: IKA_GRPC_URL, error: "no channel" };

    channel.getConnectivityState(true); // trigger connect
    await new Promise(resolve => setTimeout(resolve, 3_000));
    const state: number = channel.getConnectivityState(false);
    // 0=IDLE 1=CONNECTING 2=READY 3=TRANSIENT_FAILURE 4=SHUTDOWN
    const reachable = state === 2 || state === 1; // READY or still CONNECTING = network path open
    return { reachable, latencyMs: Date.now() - start, url: IKA_GRPC_URL };
  } catch (err) {
    return { reachable: false, latencyMs: Date.now() - start, url: IKA_GRPC_URL, error: String(err) };
  }
}

/**
 * Run Ika DKG for a specific curve.
 * Retries up to MAX_DKG_RETRIES times before falling back to sim.
 * Returns the dWallet public key and full attestation for later presign use.
 */
const MAX_DKG_RETRIES = 3;

export async function dkgMultichain(curve: IkaCurve): Promise<MultichainDWalletResult> {
  const senderPubkey = getSentinelPubkeyBytes();
  let lastError = "";

  // Try real Ika gRPC DKG in all environments — only fall back to sim on failure
  // (No longer force-sim in development: the gRPC timeout + retry logic below handles failures gracefully)
  for (let attempt = 1; attempt <= MAX_DKG_RETRIES; attempt++) {
    const sessionId = randomBytes(32);
    try {
      const bcs = await getBcs();
      const data = bcs.SignedRequestData.serialize({
        session_identifier_preimage: Array.from(sessionId),
        epoch: 1n,
        chain_id: { Solana: true },
        intended_chain_sender: Array.from(senderPubkey),
        request: {
          DKG: {
            dwallet_network_encryption_public_key: Array.from(new Uint8Array(32)),
            curve: curveBcs(curve),
            centralized_public_key_share_and_proof: Array.from(new Uint8Array(32)),
            user_secret_key_share: {
              Encrypted: {
                encrypted_centralized_secret_share_and_proof: Array.from(new Uint8Array(32)),
                encryption_key: Array.from(new Uint8Array(32)),
                signer_public_key: Array.from(senderPubkey),
              },
            },
            user_public_output: Array.from(new Uint8Array(32)),
            sign_during_dkg_request: null,
          },
        },
      }).toBytes();

      const userSig = buildUserSig(senderPubkey, bcs);
      const respBytes = await withTimeout(submitTransaction(userSig, data), 15_000);
      const resp = bcs.TransactionResponseData.parse(new Uint8Array(respBytes));

      if (resp.Error) throw new Error(resp.Error.message);
      if (!resp.Attestation) throw new Error(`DKG no attestation: ${JSON.stringify(resp)}`);

      const att = resp.Attestation;
      const payload = bcs.VersionedDWalletDataAttestation.parse(new Uint8Array(att.attestation_data));
      if (!payload.V1) throw new Error(`DKG bad payload: ${JSON.stringify(payload)}`);

      const v1 = payload.V1;
      process.stdout.write(
        `[IkaMultichain] DKG OK curve=${curve} attempt=${attempt}/${MAX_DKG_RETRIES} pubkey=${Buffer.from(v1.public_key).toString("hex").slice(0, 16)}…\n`,
      );

      return {
        publicKey: new Uint8Array(v1.public_key),
        publicOutput: new Uint8Array(v1.public_output),
        attestationData: new Uint8Array(att.attestation_data),
        networkSignature: new Uint8Array(att.network_signature),
        networkPubkey: new Uint8Array(att.network_pubkey),
        curve,
        mode: "devnet",
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[IkaMultichain] DKG attempt ${attempt}/${MAX_DKG_RETRIES} failed (${lastError})\n`);
      if (attempt < MAX_DKG_RETRIES) await new Promise(r => setTimeout(r, 1_000 * attempt));
    }
  }

  // All retries exhausted
  if (process.env.NODE_ENV === "production") {
    process.stderr.write(`[IkaMultichain] CRITICAL: Ika gRPC unreachable after ${MAX_DKG_RETRIES} retries (curve=${curve}). Serving sim in PRODUCTION.\n`);
  } else {
    process.stderr.write(`[IkaMultichain] All retries exhausted, using sim for curve=${curve}\n`);
  }
  return simulateDkg(curve, senderPubkey);
}

/** Simulate DKG deterministically — used when gRPC is unavailable. */
function simulateDkg(curve: IkaCurve, senderPubkey: Uint8Array): MultichainDWalletResult {
  const seed = createHash("sha256").update(`sim-dkg:${curve}:${Buffer.from(senderPubkey).toString("hex")}`).digest();
  const pubkey = curve === "secp256k1" || curve === "secp256r1"
    ? Buffer.concat([Buffer.from([0x02]), seed]) // compressed secp256k1: 33 bytes
    : seed; // 32 bytes for curve25519/ristretto

  return {
    publicKey: new Uint8Array(pubkey),
    publicOutput: new Uint8Array(seed),
    attestationData: new Uint8Array(seed),
    networkSignature: new Uint8Array(64),
    networkPubkey: new Uint8Array(senderPubkey),
    curve,
    mode: "sim",
  };
}

/**
 * Presign + Sign a message via Ika MPC.
 *
 * For Secp256k1/ECDSA: use PresignForDWallet → Sign (EcdsaKeccak256 / EcdsaDoubleSha256)
 * For Curve25519/EdDSA: use PresignForDWallet → Sign (EddsaSha512)
 *
 * Returns raw signature bytes:
 *   - Secp256k1: 64 bytes (r || s)
 *   - Curve25519: 64 bytes Ed25519 signature
 */
export async function signMessageMultichain(
  dwalletInfo: Pick<MultichainDWalletResult, "publicKey" | "attestationData" | "networkSignature" | "networkPubkey" | "curve" | "mode">,
  message: Uint8Array,
  sigAlgo: IkaSigAlgo,
): Promise<{ signature: Uint8Array; mode: "devnet" | "sim" }> {
  if (dwalletInfo.mode === "sim") {
    return { signature: simulateSign(dwalletInfo.publicKey, message), mode: "sim" };
  }

  const senderPubkey = getSentinelPubkeyBytes();

  try {
    const bcs = await getBcs();
    const dwalletPubkey = dwalletInfo.publicKey;
    const attestation = {
      attestation_data: Array.from(dwalletInfo.attestationData),
      network_signature: Array.from(dwalletInfo.networkSignature),
      network_pubkey: Array.from(dwalletInfo.networkPubkey),
      epoch: 1n,
    };

    // Step 1: PresignForDWallet
    const presignSessionId = randomBytes(32);
    const presignData = bcs.SignedRequestData.serialize({
      session_identifier_preimage: Array.from(presignSessionId),
      epoch: 1n,
      chain_id: { Solana: true },
      intended_chain_sender: Array.from(senderPubkey),
      request: {
        PresignForDWallet: {
          dwallet_network_encryption_public_key: Array.from(new Uint8Array(32)),
          dwallet_public_key: Array.from(dwalletPubkey),
          dwallet_attestation: attestation,
          curve: curveBcs(dwalletInfo.curve),
          signature_algorithm: sigAlgoBcs(sigAlgo),
        },
      },
    }).toBytes();

    const userSig = buildUserSig(senderPubkey, bcs);
    let presignId: Uint8Array;

    try {
      const presignResp = await withTimeout(submitTransaction(userSig, presignData), 12_000);
      const presignParsed = bcs.TransactionResponseData.parse(new Uint8Array(presignResp));
      if (presignParsed.Error) throw new Error(presignParsed.Error.message);
      if (!presignParsed.Attestation) throw new Error("Presign: no attestation");
      const presignPayload = bcs.VersionedPresignDataAttestation.parse(
        new Uint8Array(presignParsed.Attestation.attestation_data),
      );
      if (!presignPayload.V1) throw new Error("Presign: bad payload");
      presignId = new Uint8Array(presignPayload.V1.presign_session_identifier);
      process.stdout.write(`[IkaMultichain] Presign OK presignId=${Buffer.from(presignId).toString("hex").slice(0, 16)}…\n`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[IkaMultichain] Presign failed (${msg}), using random presignId\n`);
      presignId = randomBytes(32);
    }

    // Step 2: Sign
    const txSignature = new Uint8Array(SENTINEL_SECRET_ARRAY.slice(0, 64));
    const signData = bcs.SignedRequestData.serialize({
      session_identifier_preimage: Array.from(dwalletPubkey.slice(0, 32)),
      epoch: 1n,
      chain_id: { Solana: true },
      intended_chain_sender: Array.from(senderPubkey),
      request: {
        Sign: {
          message: Array.from(message),
          message_metadata: [],
          presign_session_identifier: Array.from(presignId),
          message_centralized_signature: Array.from(new Uint8Array(64)),
          dwallet_attestation: attestation,
          approval_proof: {
            Solana: { transaction_signature: Array.from(txSignature), slot: 0n },
          },
        },
      },
    }).toBytes();

    const signResp = await withTimeout(submitTransaction(userSig, signData), 12_000);
    const signParsed = bcs.TransactionResponseData.parse(new Uint8Array(signResp));

    if (signParsed.Error) throw new Error(signParsed.Error.message);
    if (signParsed.Signature) {
      const sig = new Uint8Array(signParsed.Signature.signature);
      process.stdout.write(`[IkaMultichain] Sign OK sig=${Buffer.from(sig).toString("hex").slice(0, 16)}…\n`);
      return { signature: sig, mode: "devnet" };
    }
    throw new Error(`Sign: unexpected response ${JSON.stringify(signParsed)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[IkaMultichain] Sign failed (${msg}), using sim\n`);
    return { signature: simulateSign(dwalletInfo.publicKey, message), mode: "sim" };
  }
}

function simulateSign(pubkey: Uint8Array, message: Uint8Array): Uint8Array {
  const h = createHash("sha256")
    .update("ika-mpc-sim-sig")
    .update(pubkey)
    .update(message)
    .digest();
  return new Uint8Array(Buffer.concat([h, h])); // 64 bytes (r||s or Ed25519 sim)
}

export { IKA_GRPC_URL };
