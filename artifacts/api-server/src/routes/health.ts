import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { IKA_GRPC_URL, IKA_DEVNET_PROGRAM_ID, SENTINEL_PUBKEY_HEX } from "../services/ika.js";
import { ENCRYPT_GRPC_URL, ENCRYPT_PROGRAM_ID } from "../services/encrypt.js";
import { probeIkaConnectivity } from "../services/ikaMultichain.js";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// GET /healthz/integrations — live status of all active integrations
// NOTE: Covalent / GoPlus / Wormhole are NOT used — we operate on devnet/testnet
//       and those services either don't support testnet or break the bridgeless premise.
router.get("/healthz/integrations", async (_req, res) => {
  // Live probe Ika gRPC (non-blocking, 4s max)
  const ikaProbe = await probeIkaConnectivity().catch(() => ({ reachable: false, latencyMs: -1, url: IKA_GRPC_URL }));

  res.json({
    ika: {
      status: ikaProbe.reachable ? "live" : "degraded",
      grpcUrl: IKA_GRPC_URL,
      grpcReachable: ikaProbe.reachable,
      grpcLatencyMs: ikaProbe.latencyMs,
      programId: IKA_DEVNET_PROGRAM_ID,
      sentinelPubkey: SENTINEL_PUBKEY_HEX,
      network: "solana-devnet",
      sdk: "@ika.xyz/pre-alpha-solana-client",
      dkgMaxRetries: 8,
      signMaxRetries: 6,
      features: ["DKG", "presign", "co-sign", "policy-gate", "multi-chain-native-address"],
      note: ikaProbe.reachable
        ? "Ika MPC live — DKG mode: devnet. No bridge needed."
        : "Ika gRPC currently unreachable. DKG retries up to 8x with exponential backoff. No sim fallback — throws on exhaustion.",
    },
    encrypt: {
      status: "configured",
      grpcUrl: ENCRYPT_GRPC_URL,
      programId: ENCRYPT_PROGRAM_ID,
      network: "solana-devnet",
      sdk: "@encrypt.xyz/pre-alpha-solana-client",
      features: ["createInput", "readCiphertext", "FHE-audit-log", "viewingKey"],
      note: "Encrypt FHE — intent sealed before any solver sees details. MEV shield.",
    },
    anthropic: {
      status: "configured",
      provider: "Claude Sonnet via Replit AI Integrations",
      features: ["NL-intent-parse", "route-optimize", "ai-solver-bid", "dispute-judge"],
      note: "Claude powers NL parsing, autonomous solver bids, and dispute resolution.",
    },
    solana: {
      status: "active",
      network: "devnet",
      rpc: "https://api.devnet.solana.com",
      features: ["live-tx-broadcast", "airdrop", "escrow-pda"],
    },
    bitcoin: {
      status: "active",
      network: "testnet3",
      explorer: "https://mempool.space/testnet",
      features: ["live-tx-broadcast", "PSBT-signing", "Ika-Secp256k1"],
    },
    ethereum: {
      status: "active",
      network: "sepolia",
      explorer: "https://sepolia.etherscan.io",
      features: ["live-tx-broadcast", "Ika-Secp256k1"],
    },
  });
});

export default router;
