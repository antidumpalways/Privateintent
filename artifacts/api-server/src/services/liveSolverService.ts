/**
 * Live Solver Service — Real Testnet Execution
 *
 * This service manages the "Live Solver" — a real solver with actual testnet
 * keypairs that executes genuine on-chain transactions when it wins an intent bid.
 *
 * Supported chains (all testnet/devnet, zero real funds needed):
 *   SOL Devnet   — auto-airdrop from devnet faucet
 *   ETH Sepolia  — testnet, needs Sepolia ETH from faucet
 *   BASE Sepolia — same ETH key, different RPC
 *   ARB Sepolia  — same ETH key, different RPC
 *   BTC Testnet3 — derived from ETH secp256k1 key
 *
 * Flow:
 *   1. Live Solver auto-registers in customSolverRegistry on startup (competitive fee)
 *   2. When it wins a bid, executeLiveDelivery() sends real testnet tokens
 *   3. Returns real tx hash + explorer URL — verifiable on block explorers
 */

import { ethers } from "ethers";
import * as bitcoin from "bitcoinjs-lib";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getSentinelKeypair } from "./solanaBroadcast.js";
import { registerSolver, getAllCustomSolvers } from "./customSolverRegistry.js";

// Custom BTC signer using noble/curves secp256k1 directly (no ECPair needed)
function makeBtcSigner(privKeyBytes: Buffer): { publicKey: Buffer; sign(hash: Buffer): Buffer } {
  const compressedPubkey = Buffer.from(secp256k1.getPublicKey(privKeyBytes, true));
  return {
    publicKey: compressedPubkey,
    sign(hash: Buffer): Buffer {
      const sig = secp256k1.sign(hash, privKeyBytes, { lowS: true });
      return Buffer.from((sig as any).toDERRawBytes());
    },
  };
}

// ─── Chain config ─────────────────────────────────────────────────────────────

const SOLANA_DEVNET_RPC = process.env.SOLANA_DEVNET_RPC ?? "https://api.devnet.solana.com";
const SEPOLIA_RPC       = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const BASE_SEPOLIA_RPC  = "https://sepolia.base.org";
const ARB_SEPOLIA_RPC   = "https://sepolia-rollup.arbitrum.io/rpc";
const BITCOIN_NETWORK   = bitcoin.networks.testnet;

const ETH_WALLET_PATH   = "/tmp/live-solver-eth-wallet.json";

export const LIVE_SOLVER_ID = "live-solver-private-intent";

// ─── Keypair management ───────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _ethWallet: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getEthWallet(): any {
  if (_ethWallet) return _ethWallet;

  // 1. Prefer env var — persists across restarts
  if (process.env.SOLVER_ETH_PRIVATE_KEY) {
    _ethWallet = new ethers.Wallet(process.env.SOLVER_ETH_PRIVATE_KEY);
    process.stdout.write(`[LiveSolver] ETH wallet from env: ${_ethWallet.address}\n`);
    return _ethWallet;
  }

  // 2. Fall back to file on disk
  if (existsSync(ETH_WALLET_PATH)) {
    try {
      const data = JSON.parse(readFileSync(ETH_WALLET_PATH, "utf8")) as { pk: string };
      _ethWallet = new ethers.Wallet(data.pk);
      process.stdout.write(`[LiveSolver] ETH wallet loaded: ${_ethWallet.address}\n`);
      return _ethWallet;
    } catch { /* fall through */ }
  }

  // 3. Generate new — will need funding
  const generated = ethers.Wallet.createRandom();
  _ethWallet = generated;
  try {
    writeFileSync(ETH_WALLET_PATH, JSON.stringify({ pk: generated.privateKey }), { mode: 0o600 });
  } catch { /* persistence non-fatal */ }

  process.stdout.write(`[LiveSolver] ETH wallet generated: ${generated.address}\n`);
  process.stdout.write(`[LiveSolver] Fund with Sepolia ETH at https://sepoliafaucet.com: ${generated.address}\n`);
  return generated;
}

// Live Solver SOL keypair — reads from SOLVER_RECEIVE_SECRET_KEY env var.
// This wallet holds SOL inventory and sends SOL to users when they swap
// any chain → SOL. Fund it at https://faucet.solana.com
let _solKeypair: Keypair | null = null;

function getSolKeypair(): Keypair {
  if (_solKeypair) return _solKeypair;

  // 1. Prefer env var — persists across restarts
  const envKey = process.env.SOLVER_RECEIVE_SECRET_KEY;
  if (envKey) {
    try {
      const arr = JSON.parse(envKey) as number[];
      if (Array.isArray(arr) && arr.length === 64) {
        _solKeypair = Keypair.fromSecretKey(new Uint8Array(arr));
        process.stdout.write(`[LiveSolver] SOL solver wallet from env: ${_solKeypair.publicKey.toBase58()}\n`);
        return _solKeypair;
      }
    } catch { /* fall through */ }
  }

  // 2. Fallback: generate ephemeral (will need funding)
  _solKeypair = Keypair.generate();
  process.stdout.write(`[LiveSolver] WARNING: No SOLVER_RECEIVE_SECRET_KEY in env. Generated ephemeral SOL solver wallet: ${_solKeypair.publicKey.toBase58()}\n`);
  process.stdout.write(`[LiveSolver] Fund SOL solver at https://faucet.solana.com (paste: ${_solKeypair.publicKey.toBase58()})\n`);
  process.stdout.write(`[LiveSolver] Set SOLVER_RECEIVE_SECRET_KEY in .env to persist across restarts\n`);
  return _solKeypair;
}

function getBtcAddress(): string {
  try {
    const wallet = getEthWallet();
    const privKeyBytes = Buffer.from(wallet.privateKey.slice(2), "hex");
    const signer = makeBtcSigner(privKeyBytes);
    const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: signer.publicKey, network: BITCOIN_NETWORK });
    return p2wpkh.address ?? "tb1q_derive_error";
  } catch {
    return "tb1qx43yay4naz5g5j74svq3kx2r298s9dxa0c4w5w";
  }
}

// ─── Address helpers ──────────────────────────────────────────────────────────

export function getLiveSolverAddresses(): {
  sol: string; eth: string; btc: string; base: string; arb: string;
} {
  const sol = getSolKeypair().publicKey.toBase58();
  const eth = getEthWallet().address;
  const btc = getBtcAddress();
  return { sol, eth, btc, base: eth, arb: eth };
}

// ─── Balance fetching (real RPC calls) ───────────────────────────────────────

export interface ChainBalance {
  chain: string;
  network: string;
  address: string;
  balance: string;
  balanceRaw: string;
  unit: string;
  funded: boolean;
  faucetUrl: string;
  explorerUrl: string;
  explorerAddressUrl: string;
  rpc: string;
}

export async function getLiveSolverBalances(): Promise<ChainBalance[]> {
  const addrs = getLiveSolverAddresses();

  const results = await Promise.allSettled([
    // SOL Devnet
    (async (): Promise<ChainBalance> => {
      const conn = new Connection(SOLANA_DEVNET_RPC, "confirmed");
      const lamports = await conn.getBalance(new PublicKey(addrs.sol));
      const sol = (lamports / 1e9).toFixed(6);
      return {
        chain: "SOL", network: "Devnet", address: addrs.sol,
        balance: sol, balanceRaw: lamports.toString(), unit: "SOL",
        funded: lamports > 10_000,
        faucetUrl: "https://faucet.solana.com",
        explorerUrl: "https://explorer.solana.com/?cluster=devnet",
        explorerAddressUrl: `https://explorer.solana.com/address/${addrs.sol}?cluster=devnet`,
        rpc: SOLANA_DEVNET_RPC,
      };
    })(),

    // ETH Sepolia
    (async (): Promise<ChainBalance> => {
      const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
      const bal = await provider.getBalance(addrs.eth);
      const eth = ethers.formatEther(bal);
      return {
        chain: "ETH", network: "Sepolia", address: addrs.eth,
        balance: parseFloat(eth).toFixed(6), balanceRaw: bal.toString(), unit: "ETH",
        funded: bal > 0n,
        faucetUrl: "https://sepoliafaucet.com",
        explorerUrl: "https://sepolia.etherscan.io",
        explorerAddressUrl: `https://sepolia.etherscan.io/address/${addrs.eth}`,
        rpc: SEPOLIA_RPC,
      };
    })(),

    // BASE Sepolia
    (async (): Promise<ChainBalance> => {
      const provider = new ethers.JsonRpcProvider(BASE_SEPOLIA_RPC);
      const bal = await provider.getBalance(addrs.base);
      const eth = ethers.formatEther(bal);
      return {
        chain: "BASE", network: "Sepolia", address: addrs.base,
        balance: parseFloat(eth).toFixed(6), balanceRaw: bal.toString(), unit: "ETH",
        funded: bal > 0n,
        faucetUrl: "https://docs.base.org/docs/tools/network-faucets",
        explorerUrl: "https://sepolia.basescan.org",
        explorerAddressUrl: `https://sepolia.basescan.org/address/${addrs.base}`,
        rpc: BASE_SEPOLIA_RPC,
      };
    })(),

    // ARB Sepolia
    (async (): Promise<ChainBalance> => {
      const provider = new ethers.JsonRpcProvider(ARB_SEPOLIA_RPC);
      const bal = await provider.getBalance(addrs.arb);
      const eth = ethers.formatEther(bal);
      return {
        chain: "ARB", network: "Sepolia", address: addrs.arb,
        balance: parseFloat(eth).toFixed(6), balanceRaw: bal.toString(), unit: "ETH",
        funded: bal > 0n,
        faucetUrl: "https://faucet.arbitrum.io",
        explorerUrl: "https://sepolia.arbiscan.io",
        explorerAddressUrl: `https://sepolia.arbiscan.io/address/${addrs.arb}`,
        rpc: ARB_SEPOLIA_RPC,
      };
    })(),

    // BTC Testnet3 (via mempool.space API)
    (async (): Promise<ChainBalance> => {
      let satoshis = 0;
      try {
        const r = await fetch(`https://mempool.space/testnet/api/address/${addrs.btc}`);
        if (r.ok) {
          const data = await r.json() as any;
          satoshis = (data.chain_stats?.funded_txo_sum ?? 0) - (data.chain_stats?.spent_txo_sum ?? 0);
        }
      } catch { /* ignore */ }
      const btc = (satoshis / 1e8).toFixed(8);
      return {
        chain: "BTC", network: "Testnet3", address: addrs.btc,
        balance: btc, balanceRaw: satoshis.toString(), unit: "tBTC",
        funded: satoshis > 1000,
        faucetUrl: "https://coinfaucet.eu/en/btc-testnet",
        explorerUrl: "https://mempool.space/testnet",
        explorerAddressUrl: `https://mempool.space/testnet/address/${addrs.btc}`,
        rpc: "https://mempool.space/testnet/api",
      };
    })(),
  ]);

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    const chains = ["SOL", "ETH", "BASE", "ARB", "BTC"];
    return {
      chain: chains[i]!, network: "unknown", address: "", balance: "0", balanceRaw: "0",
      unit: "", funded: false, faucetUrl: "", explorerUrl: "",
      explorerAddressUrl: "", rpc: "", error: (r.reason as Error)?.message,
    } as any;
  });
}

// ─── SOL Airdrop ──────────────────────────────────────────────────────────────

export interface AirdropResult {
  success: boolean;
  chain: string;
  txSig?: string;
  explorerUrl?: string;
  balanceAfter?: number;
  error?: string;
}

export async function requestSolAirdrop(): Promise<AirdropResult> {
  const kp = getSolKeypair();
  const conn = new Connection(SOLANA_DEVNET_RPC, "confirmed");
  try {
    const sig = await conn.requestAirdrop(kp.publicKey, 1_000_000_000); // 1 SOL
    await conn.confirmTransaction(sig, "confirmed");
    const bal = await conn.getBalance(kp.publicKey);
    process.stdout.write(`[LiveSolver] SOL airdrop confirmed sig=${sig.slice(0, 16)}… bal=${bal / 1e9} SOL\n`);
    return {
      success: true,
      chain: "SOL",
      txSig: sig,
      explorerUrl: `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
      balanceAfter: bal / 1e9,
    };
  } catch (e) {
    const msg = (e as Error).message;
    return { success: false, chain: "SOL", error: msg };
  }
}

// ─── Solver capacity (real-time inventory) ────────────────────────────────────

export interface SolverCapacity {
  sol: {
    address: string;
    balance: number;
    maxDeliverable: number;
    status: "ok" | "low" | "critical";
  };
  eth: {
    address: string;
    balance: number;
    maxDeliverable: number;
    status: "ok" | "low" | "critical";
  };
}

/**
 * Fetch real-time solver inventory from chain RPCs.
 * Returns actual deliverable amounts after reserves (rent-exempt + gas).
 * Used for honest bidding and the /api/solver/health endpoint.
 */
export async function getLiveSolverCapacity(): Promise<SolverCapacity> {
  const addrs = getLiveSolverAddresses();
  const RENT_EXEMPT_BUF = 1_200_000;
  const FEE_RESERVE     =    10_000;

  const [solResult, ethResult] = await Promise.allSettled([
    (async () => {
      const conn = new Connection(SOLANA_DEVNET_RPC, "confirmed");
      const lamports = await conn.getBalance(new PublicKey(addrs.sol));
      const maxLamports = Math.max(0, lamports - RENT_EXEMPT_BUF - FEE_RESERVE);
      const balance = lamports / 1e9;
      const maxDeliverable = maxLamports / 1e9;
      return {
        address: addrs.sol, balance, maxDeliverable,
        status: (maxDeliverable <= 0 ? "critical" : maxDeliverable < 0.005 ? "low" : "ok") as "ok" | "low" | "critical",
      };
    })(),
    (async () => {
      const wallet   = getEthWallet();
      const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
      const wei      = await provider.getBalance(wallet.address);
      const feeData  = await provider.getFeeData();
      const gasCost  = (feeData.maxFeePerGas ?? ethers.parseUnits("20", "gwei")) * 21000n;
      const gasBuffer = gasCost * 2n;
      const maxWei   = wei > gasBuffer ? wei - gasBuffer : 0n;
      const balance  = parseFloat(ethers.formatEther(wei));
      const maxDeliverable = parseFloat(ethers.formatEther(maxWei));
      return {
        address: wallet.address, balance, maxDeliverable,
        status: (maxDeliverable <= 0 ? "critical" : maxDeliverable < 0.005 ? "low" : "ok") as "ok" | "low" | "critical",
      };
    })(),
  ]);

  const sol = solResult.status === "fulfilled"
    ? solResult.value
    : { address: addrs.sol, balance: 0, maxDeliverable: 0, status: "critical" as const };
  const eth = ethResult.status === "fulfilled"
    ? ethResult.value
    : { address: addrs.eth, balance: 0, maxDeliverable: 0, status: "critical" as const };

  return { sol, eth };
}

// ─── Background SOL auto-airdrop loop (devnet only) ──────────────────────────

/**
 * Start a background loop that auto-airdrops SOL on devnet when solver inventory is low.
 * No-op in production. Call once from server startup.
 */
export function startSolAutoAirdropLoop(): void {
  if (process.env.NODE_ENV === "production") return;

  const REFILL_THRESHOLD = 5_000_000; // < 0.005 SOL → refill
  const INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes

  process.stdout.write(`[SolverInventory] SOL auto-airdrop loop started (threshold: ${REFILL_THRESHOLD / 1e9} SOL, interval: 10min)\n`);

  setInterval(async () => {
    try {
      const kp   = getSolKeypair();
      const conn = new Connection(SOLANA_DEVNET_RPC, "confirmed");
      const bal  = await conn.getBalance(kp.publicKey);
      if (bal < REFILL_THRESHOLD) {
        process.stdout.write(`[SolverInventory] SOL low (${(bal / 1e9).toFixed(4)} SOL) — attempting auto-airdrop…\n`);
        for (const amt of [1_000_000_000, 500_000_000, 200_000_000]) {
          try {
            const sig    = await conn.requestAirdrop(kp.publicKey, amt);
            await conn.confirmTransaction(sig, "confirmed");
            const newBal = await conn.getBalance(kp.publicKey);
            process.stdout.write(`[SolverInventory] SOL auto-airdrop +${amt / 1e9} SOL OK. Balance now: ${(newBal / 1e9).toFixed(4)} SOL\n`);
            break;
          } catch (e) {
            process.stderr.write(`[SolverInventory] auto-airdrop ${amt / 1e9} SOL failed: ${(e as Error).message?.slice(0, 60)}\n`);
          }
        }
      }
    } catch (e) {
      process.stderr.write(`[SolverInventory] auto-airdrop loop error: ${(e as Error).message?.slice(0, 80)}\n`);
    }
  }, INTERVAL_MS);
}

// ─── Live delivery execution ──────────────────────────────────────────────────

export interface LiveDeliveryParams {
  toChain: string;
  destinationAddress: string;
  outputAmount: string;
  intentId: number;
}

export interface LiveDeliveryResult {
  success: boolean;
  txHash: string;
  explorerUrl: string;
  chain: string;
  network: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  unit: string;
  isReal: boolean;
  error?: string;
}

export async function executeLiveDelivery(params: LiveDeliveryParams): Promise<LiveDeliveryResult> {
  const { toChain, destinationAddress, outputAmount, intentId } = params;
  const addrs = getLiveSolverAddresses();

  process.stdout.write(`[LiveSolver] executing delivery intentId=${intentId} chain=${toChain} dest=${destinationAddress} amt=${outputAmount}\n`);

  if (toChain === "SOL") {
    return executeSolDelivery(addrs.sol, destinationAddress, outputAmount, intentId);
  } else if (toChain === "ETH") {
    return executeEvmDelivery("ETH", "Sepolia", SEPOLIA_RPC, addrs.eth, destinationAddress, outputAmount, intentId);
  } else if (toChain === "BASE") {
    return executeEvmDelivery("BASE", "Sepolia", BASE_SEPOLIA_RPC, addrs.base, destinationAddress, outputAmount, intentId);
  } else if (toChain === "ARB") {
    return executeEvmDelivery("ARB", "Sepolia", ARB_SEPOLIA_RPC, addrs.arb, destinationAddress, outputAmount, intentId);
  } else if (toChain === "BTC") {
    return executeBtcDelivery(addrs.btc, destinationAddress, outputAmount, intentId);
  }

  return {
    success: false, txHash: "", explorerUrl: "", chain: toChain, network: "unknown",
    fromAddress: "", toAddress: destinationAddress, amount: outputAmount, unit: "",
    isReal: false, error: `Unsupported chain: ${toChain}`,
  };
}

// ─── SOL delivery ─────────────────────────────────────────────────────────────

async function executeSolDelivery(
  from: string,
  to: string,
  amountStr: string,
  intentId: number,
): Promise<LiveDeliveryResult> {
  const kp = getSolKeypair();
  const conn = new Connection(SOLANA_DEVNET_RPC, "confirmed");

  // Ensure solver is funded — auto-airdrop if balance is too low to deliver anything meaningful
  let balance = await conn.getBalance(kp.publicKey);
  const RENT_EXEMPT_BUFFER = 1_200_000; // ~0.0012 SOL — well above Solana rent-exempt min (~890k)
  const FEE_RESERVE        =    10_000; // typical fee for a simple SystemProgram.transfer

  if (balance < RENT_EXEMPT_BUFFER + FEE_RESERVE) {
    process.stdout.write(`[LiveSolver/SOL] balance low (${balance} lamports) — attempting airdrop…\n`);
    for (const airdropAmt of [1_000_000_000, 500_000_000, 200_000_000]) {
      try {
        const sig = await conn.requestAirdrop(kp.publicKey, airdropAmt);
        await conn.confirmTransaction(sig, "confirmed");
        balance = await conn.getBalance(kp.publicKey);
        process.stdout.write(`[LiveSolver/SOL] airdrop OK +${airdropAmt / 1e9} SOL → bal=${balance / 1e9} SOL\n`);
        break;
      } catch (e) {
        process.stderr.write(`[LiveSolver/SOL] airdrop ${airdropAmt / 1e9} SOL failed: ${(e as Error).message?.slice(0, 60)}\n`);
      }
    }
    balance = await conn.getBalance(kp.publicKey);
  }

  if (balance < RENT_EXEMPT_BUFFER + FEE_RESERVE) {
    return {
      success: false, txHash: "", explorerUrl: "", chain: "SOL", network: "Devnet",
      fromAddress: from, toAddress: to, amount: amountStr, unit: "SOL",
      isReal: false, error: `Solver SOL balance too low (${(balance / 1e9).toFixed(4)} SOL). Airdrop rate-limited. Visit https://faucet.solana.com`,
    };
  }

  let lamports = Math.floor(parseFloat(amountStr) * 1e9);
  if (lamports < 1) lamports = 10_000;

  // Must leave at least RENT_EXEMPT_BUFFER in sender's account after transfer + fee,
  // otherwise Solana simulation rejects the tx (below rent-exempt minimum).
  const maxSend = balance - RENT_EXEMPT_BUFFER - FEE_RESERVE;
  if (lamports > maxSend) {
    process.stdout.write(`[LiveSolver/SOL] capping delivery ${lamports} → ${maxSend} lamports (balance=${balance})\n`);
    lamports = maxSend;
  }

  try {
    const toPubkey = new PublicKey(to);
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: kp.publicKey }).add(
      SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey, lamports }),
    );
    tx.lastValidBlockHeight = lastValidBlockHeight;

    const sig = await sendAndConfirmTransaction(conn, tx, [kp], { commitment: "confirmed" });
    process.stdout.write(`[LiveSolver/SOL] REAL tx confirmed sig=${sig.slice(0, 16)}… lamports=${lamports}\n`);

    return {
      success: true,
      txHash: sig,
      explorerUrl: `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
      chain: "SOL", network: "Devnet",
      fromAddress: from, toAddress: to,
      amount: (lamports / 1e9).toFixed(9), unit: "SOL",
      isReal: true,
    };
  } catch (e) {
    const msg = (e as Error).message?.slice(0, 120);
    process.stderr.write(`[LiveSolver/SOL] tx failed: ${msg}\n`);
    return {
      success: false, txHash: "", explorerUrl: "", chain: "SOL", network: "Devnet",
      fromAddress: from, toAddress: to, amount: amountStr, unit: "SOL",
      isReal: false, error: msg,
    };
  }
}

// ─── EVM delivery (ETH/BASE/ARB Sepolia) ─────────────────────────────────────

async function executeEvmDelivery(
  chainLabel: string,
  networkLabel: string,
  rpcUrl: string,
  from: string,
  to: string,
  amountStr: string,
  intentId: number,
): Promise<LiveDeliveryResult> {
  const wallet = getEthWallet();
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const connectedWallet = wallet.connect(provider);

  const explorerBase = chainLabel === "ETH" ? "https://sepolia.etherscan.io"
    : chainLabel === "BASE" ? "https://sepolia.basescan.org"
    : "https://sepolia.arbiscan.io";

  const balance = await provider.getBalance(wallet.address);

  if (balance === 0n) {
    const faucetUrl = chainLabel === "ETH" ? "https://sepoliafaucet.com"
      : chainLabel === "BASE" ? "https://docs.base.org/docs/tools/network-faucets"
      : "https://faucet.arbitrum.io";
    return {
      success: false, txHash: "", explorerUrl: explorerBase, chain: chainLabel, network: networkLabel,
      fromAddress: from, toAddress: to, amount: amountStr, unit: "ETH",
      isReal: false, error: `Solver wallet unfunded. Get ${chainLabel} Sepolia ETH at: ${faucetUrl}`,
    };
  }

  let valueWei: bigint;
  try {
    valueWei = ethers.parseEther(amountStr);
  } catch {
    valueWei = ethers.parseEther("0.0001");
  }

  // Cap at 80% of balance (leave gas)
  const feeData = await provider.getFeeData();
  const gasCost = (feeData.maxFeePerGas ?? ethers.parseUnits("20", "gwei")) * 21000n;
  const maxSend = balance > gasCost * 2n ? balance - gasCost * 2n : 0n;
  if (maxSend === 0n) {
    return {
      success: false, txHash: "", explorerUrl: explorerBase, chain: chainLabel, network: networkLabel,
      fromAddress: from, toAddress: to, amount: amountStr, unit: "ETH",
      isReal: false, error: "Insufficient ETH to cover gas + delivery",
    };
  }
  if (valueWei > maxSend) valueWei = maxSend;

  // Hard-fail if destination is invalid — never silently send to solver's own wallet
  if (!ethers.isAddress(to) || to === ethers.ZeroAddress) {
    return {
      success: false, txHash: "", explorerUrl: explorerBase, chain: chainLabel, network: networkLabel,
      fromAddress: from, toAddress: to, amount: amountStr, unit: "ETH",
      isReal: false, error: `Invalid or missing ETH destination address: "${to}". Cannot deliver ETH for SOL→ETH swap.`,
    };
  }

  try {
    const toAddr = to;
    const tx = await connectedWallet.sendTransaction({ to: toAddr, value: valueWei });
    await tx.wait(1);

    process.stdout.write(`[LiveSolver/${chainLabel}] REAL tx confirmed hash=${tx.hash.slice(0, 18)}… value=${ethers.formatEther(valueWei)} ETH\n`);

    return {
      success: true,
      txHash: tx.hash,
      explorerUrl: `${explorerBase}/tx/${tx.hash}`,
      chain: chainLabel, network: networkLabel,
      fromAddress: from, toAddress: toAddr,
      amount: ethers.formatEther(valueWei), unit: "ETH",
      isReal: true,
    };
  } catch (e) {
    const msg = (e as Error).message?.slice(0, 120);
    process.stderr.write(`[LiveSolver/${chainLabel}] tx failed: ${msg}\n`);
    return {
      success: false, txHash: "", explorerUrl: explorerBase, chain: chainLabel, network: networkLabel,
      fromAddress: from, toAddress: to, amount: amountStr, unit: "ETH",
      isReal: false, error: msg,
    };
  }
}

// ─── BTC Testnet3 delivery ────────────────────────────────────────────────────

async function executeBtcDelivery(
  from: string,
  to: string,
  amountStr: string,
  intentId: number,
): Promise<LiveDeliveryResult> {
  const wallet = getEthWallet();
  const privKeyBytes = Buffer.from(wallet.privateKey.slice(2), "hex");

  // Fetch UTXOs from mempool.space testnet
  let utxos: Array<{ txid: string; vout: number; value: number }> = [];
  try {
    const r = await fetch(`https://mempool.space/testnet/api/address/${from}/utxo`);
    if (r.ok) utxos = (await r.json() as any[]).map((u: any) => ({
      txid: u.txid, vout: u.vout, value: u.value,
    }));
  } catch { /* ignore */ }

  if (utxos.length === 0) {
    return {
      success: false, txHash: "", explorerUrl: "https://mempool.space/testnet", chain: "BTC", network: "Testnet3",
      fromAddress: from, toAddress: to, amount: amountStr, unit: "tBTC",
      isReal: false,
      error: `BTC solver wallet has no UTXOs. Fund testnet wallet at: https://coinfaucet.eu/en/btc-testnet (address: ${from})`,
    };
  }

  const satoshis = Math.floor(parseFloat(amountStr) * 1e8);
  const totalIn = utxos.reduce((s, u) => s + u.value, 0);
  const feeRate = 5;
  const estimatedVbytes = utxos.length * 68 + 31 + 10;
  const fee = estimatedVbytes * feeRate;

  if (totalIn < satoshis + fee) {
    return {
      success: false, txHash: "", explorerUrl: "https://mempool.space/testnet", chain: "BTC", network: "Testnet3",
      fromAddress: from, toAddress: to, amount: amountStr, unit: "tBTC",
      isReal: false, error: `Insufficient tBTC. Balance: ${(totalIn / 1e8).toFixed(8)} tBTC, needed: ${((satoshis + fee) / 1e8).toFixed(8)} tBTC`,
    };
  }

  try {
    const signer = makeBtcSigner(privKeyBytes);
    const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: signer.publicKey, network: BITCOIN_NETWORK });

    const psbt = new bitcoin.Psbt({ network: BITCOIN_NETWORK });
    psbt.setVersion(2);

    for (const utxo of utxos) {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: { script: p2wpkh.output!, value: BigInt(utxo.value) },
      });
    }

    const toScript = bitcoin.address.toOutputScript(to, BITCOIN_NETWORK);
    psbt.addOutput({ script: toScript, value: BigInt(satoshis) });

    const change = totalIn - satoshis - fee;
    if (change > 546) {
      psbt.addOutput({ script: p2wpkh.output!, value: BigInt(change) });
    }

    psbt.signAllInputs(signer as any);
    psbt.finalizeAllInputs();

    const txHex = psbt.extractTransaction().toHex();

    const broadcastResp = await fetch("https://mempool.space/testnet/api/tx", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: txHex,
    });

    if (!broadcastResp.ok) {
      const errText = await broadcastResp.text();
      throw new Error(`Broadcast rejected: ${errText.slice(0, 80)}`);
    }

    const txId = await broadcastResp.text();
    process.stdout.write(`[LiveSolver/BTC] REAL tx broadcast txId=${txId.slice(0, 16)}…\n`);

    return {
      success: true,
      txHash: txId,
      explorerUrl: `https://mempool.space/testnet/tx/${txId}`,
      chain: "BTC", network: "Testnet3",
      fromAddress: from, toAddress: to,
      amount: (satoshis / 1e8).toFixed(8), unit: "tBTC",
      isReal: true,
    };
  } catch (e) {
    const msg = (e as Error).message?.slice(0, 120);
    process.stderr.write(`[LiveSolver/BTC] tx failed: ${msg}\n`);
    return {
      success: false, txHash: "", explorerUrl: "https://mempool.space/testnet", chain: "BTC", network: "Testnet3",
      fromAddress: from, toAddress: to, amount: amountStr, unit: "tBTC",
      isReal: false, error: msg,
    };
  }
}

// ─── ETH Escrow Contract (PrivateIntentEscrow on Sepolia) ────────────────────
// Deployed contract that holds user ETH until delivery proof is verified.
// Operator (solver wallet) calls release() to pay solver after delivery.

// Resolve artifact path for all runtime modes:
const _dir = dirname(fileURLToPath(import.meta.url));
const _artifactPrimary   = join(_dir, "../contracts/PrivateIntentEscrow.json");
const _artifactFallback  = join(_dir, "../../contracts/PrivateIntentEscrow.json");
const _artifactEscrowBuild = join(_dir, "../../escrow-contract/build/PrivateIntentEscrow.json");

let _escrowArtifact: { address: string; abi: any[] } | null = null;
function getEscrowArtifact() {
  if (!_escrowArtifact) {
    const candidates = [_artifactPrimary, _artifactFallback, _artifactEscrowBuild];
    const path = candidates.find(p => existsSync(p)) ?? _artifactPrimary;
    _escrowArtifact = JSON.parse(readFileSync(path, "utf8"));
  }
  return _escrowArtifact!;
}

export function getEscrowContractAddress(): string {
  // Allow operator to override deployed address via env (e.g. after redeployment).
  // Support both ETH_ESCROW_CONTRACT and ETH_ESCROW_CONTRACT_ADDRESS env var names.
  return (
    process.env.ETH_ESCROW_CONTRACT ??
    process.env.ETH_ESCROW_CONTRACT_ADDRESS ??
    getEscrowArtifact().address
  );
}

/**
 * Verify an ETH deposit on-chain for the given on-chain intentId.
 *
 * Primary path: polls the escrow contract via getIntent(onchainIntentId).
 * The real contract returns an Intent struct — status 1 = Active (deposited).
 * IntentStatus: 0=Pending,1=Active,2=Delivered,3=Settled,4=Refunded,5=Disputed
 *
 * If sourceTxHash is provided and the contract call fails, falls back to
 * verifying the raw tx receipt (to == contract, value > 0).
 */
export async function checkEthDepositOnChain(
  onchainIntentId: number,
  maxWaitMs = 20_000,
  sourceTxHash?: string,
): Promise<{ amount: bigint; released: boolean; refunded: boolean } | null> {
  const provider     = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const pollInterval = 4_000;
  const deadline     = Date.now() + maxWaitMs;

  const escrowContract = getEscrowContract(provider);
  const contractAddr   = getEscrowContractAddress().toLowerCase();
  let contractWorked   = false;

  while (Date.now() < deadline) {
    try {
      const dep = await escrowContract.getIntent(BigInt(onchainIntentId));
      if (dep && dep.amount > 0n) {
        contractWorked = true;
        // IntentStatus enum: 1=Active, 3=Settled, 4=Refunded
        const status   = Number(dep.status ?? 0);
        const released = status >= 3;
        const refunded = status === 4;
        process.stdout.write(`[LiveSolver/ETH-check] onchainId=${onchainIntentId} confirmed via getIntent() amount=${ethers.formatEther(dep.amount)} ETH status=${status}\n`);
        return { amount: dep.amount, released, refunded };
      }
      contractWorked = true;
    } catch { /* RPC hiccup or not yet mined */ }
    await new Promise<void>(r => setTimeout(r, pollInterval));
  }

  // Fallback: verify raw tx receipt if contract call never succeeded
  if (!contractWorked && sourceTxHash) {
    process.stdout.write(`[LiveSolver/ETH-check] getIntent() unavailable — verifying tx receipt for ${sourceTxHash.slice(0, 14)}…\n`);
    const deadline2 = Date.now() + maxWaitMs;
    while (Date.now() < deadline2) {
      try {
        const receipt = await provider.getTransactionReceipt(sourceTxHash);
        if (receipt && receipt.status === 1) {
          const tx = await provider.getTransaction(sourceTxHash);
          if (tx && tx.to?.toLowerCase() === contractAddr && tx.value > 0n) {
            process.stdout.write(`[LiveSolver/ETH-check] tx ${sourceTxHash.slice(0, 12)}… confirmed → contract, value=${ethers.formatEther(tx.value)} ETH\n`);
            return { amount: tx.value, released: false, refunded: false };
          }
        }
      } catch { /* retry */ }
      await new Promise<void>(r => setTimeout(r, pollInterval));
    }
  }

  return null;
}

function getEscrowContract(signerOrProvider?: ethers.Signer | ethers.Provider): ethers.Contract {
  // Use getEscrowContractAddress() so ETH_ESCROW_CONTRACT env override is always respected
  const { abi } = getEscrowArtifact();
  const address = getEscrowContractAddress();
  return new ethers.Contract(address, abi, signerOrProvider);
}

export interface EthEscrowResult {
  success: boolean;
  txHash: string;
  explorerUrl: string;
  escrowAddress: string;
  onchainIntentId?: number;
  error?: string;
}

/**
 * Solver-side fallback: call createIntent() on the escrow contract on behalf of
 * the intent (used when the user did NOT sign from Phantom — e.g. API-only paths).
 * Uses the real contract ABI: createIntent(string,string,string,string,uint256,string)
 */
export async function lockEthEscrow(
  amount: string,
  intentId: number,
  params: { fromChain: string; toChain: string; fromToken: string; toToken: string; proofHash?: string | null },
): Promise<EthEscrowResult> {
  const wallet   = getEthWallet();
  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const connected = wallet.connect(provider);
  const contractAddress = getEscrowContractAddress();

  process.stdout.write(`[LiveSolver/ETH-escrow] createIntent dbId=${intentId} ${params.fromChain}→${params.toChain} amt=${amount} → contract ${contractAddress.slice(0, 10)}…\n`);

  const balance = await provider.getBalance(wallet.address);
  if (balance === 0n) {
    return {
      success: false, txHash: "", escrowAddress: contractAddress,
      explorerUrl: "https://sepolia.etherscan.io",
      error: "Solver ETH wallet unfunded on Sepolia. Fund at: https://sepoliafaucet.com",
    };
  }

  let valueWei: bigint;
  try { valueWei = ethers.parseEther(amount); }
  catch { valueWei = ethers.parseEther("0.0001"); }

  const feeData = await provider.getFeeData();
  const gasPrice = feeData.maxFeePerGas ?? ethers.parseUnits("20", "gwei");
  const gasCost  = gasPrice * 200_000n;
  const maxSend  = balance > gasCost * 2n ? balance - gasCost * 2n : 0n;
  if (maxSend === 0n) {
    return {
      success: false, txHash: "", escrowAddress: contractAddress,
      explorerUrl: "https://sepolia.etherscan.io",
      error: "Insufficient ETH balance to cover gas for escrow deposit",
    };
  }
  if (valueWei > maxSend) valueWei = maxSend;

  const releaseAfter = 0n; // no timelock for hackathon
  if (!params.proofHash) {
    throw new Error(
      `[lockEthEscrow] No proofHash for intentId=${intentId}. ` +
      `Intent must have a real Encrypt FHE ID before ETH escrow can be created. ` +
      `Submit the intent first via POST /api/intent/submit.`
    );
  }
  const proofHash = params.proofHash;
  const escrowContract = getEscrowContract(connected);

  try {
    const tx = await escrowContract.createIntent(
      params.fromChain, params.toChain, params.fromToken, params.toToken,
      releaseAfter, proofHash,
      { value: valueWei, gasLimit: 300_000 },
    );
    const receipt = await tx.wait(1);
    // Parse onchain intentId from IntentCreated event
    let onchainIntentId: number | undefined;
    for (const log of (receipt?.logs ?? [])) {
      try {
        const parsed = escrowContract.interface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed?.name === "IntentCreated") {
          onchainIntentId = Number(parsed.args.intentId);
          break;
        }
      } catch { /* skip non-matching logs */ }
    }
    process.stdout.write(`[LiveSolver/ETH-escrow] createIntent confirmed hash=${tx.hash.slice(0, 18)}… value=${ethers.formatEther(valueWei)} ETH onchainId=${onchainIntentId ?? "?"}\n`);
    return {
      success: true,
      txHash: tx.hash,
      explorerUrl: `https://sepolia.etherscan.io/tx/${tx.hash}`,
      escrowAddress: contractAddress,
      onchainIntentId,
    };
  } catch (e) {
    const msg = (e as Error).message?.slice(0, 200);
    process.stderr.write(`[LiveSolver/ETH-escrow] contract deposit failed: ${msg}\n`);
    return { success: false, txHash: "", escrowAddress: contractAddress, explorerUrl: "https://sepolia.etherscan.io", error: msg };
  }
}

export interface EthReleaseResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

/**
 * Release ETH from the escrow contract to the solver after delivery proof.
 *
 * Uses the real contract ABI: settleIntent(uint256, address, string)
 * onchainIntentId — the contract-assigned ID from IntentCreated event (NOT the DB id).
 * deliveryTxHash  — solver's delivery proof tx hash (required by real contract).
 *
 * Polls for the deposit to be on-chain first (handles race with pending Phantom tx).
 */
export async function releaseFromEscrowContract(
  intentId: number,
  solverEthAddress: string,
  deliveryTxHash: string,
  onchainIntentId?: number,
): Promise<EthReleaseResult> {
  const POLL_INTERVAL_MS = 5_000;
  const POLL_TIMEOUT_MS  = 120_000;

  const wallet   = getEthWallet();
  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const connected = wallet.connect(provider);
  const contractAddress = getEscrowContractAddress();
  const escrowContract  = getEscrowContract(connected);
  // Prefer the on-chain intentId from the IntentCreated event; fall back to DB id only if unknown
  const contractIntentId = BigInt(onchainIntentId ?? intentId);

  process.stdout.write(`[LiveSolver/ETH-release] waiting for deposit: dbId=${intentId} onchainId=${onchainIntentId ?? "?"} contract=${contractAddress.slice(0, 10)}…\n`);

  // ── Poll until deposit appears on-chain ────────────────────────────────────
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let dep: { amount: bigint; status: number } | null = null;

  while (Date.now() < deadline) {
    try {
      const raw = await escrowContract.getIntent(contractIntentId);
      if (raw && raw.amount > 0n) {
        const status = Number(raw.status ?? 0);
        dep = { amount: raw.amount, status };
        if (status === 1) break; // Active — ready to settle
        if (status >= 3) {
          process.stdout.write(`[LiveSolver/ETH-release] onchainId=${contractIntentId} already settled (status=${status})\n`);
          return { success: true };
        }
      }
    } catch { dep = null; }
    process.stdout.write(`[LiveSolver/ETH-release] onchainId=${contractIntentId} not yet Active, retrying in ${POLL_INTERVAL_MS / 1000}s…\n`);
    await new Promise<void>(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  if (!dep || dep.amount === 0n) {
    const msg = `Deposit for onchainId=${contractIntentId} not confirmed on-chain after ${POLL_TIMEOUT_MS / 1000}s`;
    process.stderr.write(`[LiveSolver/ETH-release] ${msg}\n`);
    return { success: false, error: msg };
  }

  // ── Settle to solver — real contract requires a non-empty delivery proof ──────
  // The delivery tx hash may be an Ethereum 0x... hash (66 chars) for ETH→ETH delivery,
  // or a Solana base58 signature (~88 chars) for ETH→SOL delivery. The on-chain contract
  // stores it as a string and does not enforce format — chain-aware validation here.
  const isEthTx  = deliveryTxHash.startsWith("0x") && deliveryTxHash.length === 66;
  const isSolTx  = /^[1-9A-HJ-NP-Za-km-z]{43,90}$/.test(deliveryTxHash); // base58
  if (!deliveryTxHash || (!isEthTx && !isSolTx)) {
    const msg = `Cannot settle ETH escrow: deliveryTxHash is missing or not a valid on-chain tx. ` +
      `Got: "${deliveryTxHash.slice(0, 20)}…". Expected ETH (0x+66chars) or SOL (base58 43-90 chars). ` +
      `Delivery must complete successfully before settlement.`;
    process.stderr.write(`[LiveSolver/ETH-release] ${msg}\n`);
    return { success: false, error: msg };
  }
  try {
    const proof = deliveryTxHash;
    process.stdout.write(`[LiveSolver/ETH-release] settleIntent onchainId=${contractIntentId} amt=${ethers.formatEther(dep.amount)} ETH → ${solverEthAddress.slice(0, 10)}…\n`);
    const tx = await escrowContract.settleIntent(contractIntentId, solverEthAddress, proof, { gasLimit: 200_000 });
    await tx.wait(1);
    process.stdout.write(`[LiveSolver/ETH-release] SETTLED tx=${tx.hash.slice(0, 18)}… amt=${ethers.formatEther(dep.amount)} ETH\n`);
    // Inventory recycling log — shows solver ETH replenished from escrow
    try {
      const newBal = await provider.getBalance(wallet.address);
      process.stdout.write(`[SolverInventory] +${ethers.formatEther(dep.amount)} ETH received from settlement intentId=${contractIntentId}. ETH wallet now: ${parseFloat(ethers.formatEther(newBal)).toFixed(6)} ETH\n`);
    } catch { /* non-fatal */ }
    return { success: true, txHash: tx.hash };
  } catch (e) {
    const msg = (e as Error).message?.slice(0, 200);
    process.stderr.write(`[LiveSolver/ETH-release] release tx failed: ${msg}\n`);
    return { success: false, error: msg };
  }
}

// ─── Solver fulfillment pre-check ─────────────────────────────────────────────

/**
 * Check if the Live Solver has sufficient inventory to fulfill a delivery
 * BEFORE locking the user's escrow. Returns ok=false if the solver can't deliver,
 * so the accept route can reject early rather than locking funds and failing later.
 *
 * toChain  — the output chain ("SOL", "ETH", "BASE", "ARB")
 * outputAmount — the quoted delivery amount (string, e.g. "0.003996")
 */
export async function checkSolverCanFulfill(
  toChain: string,
  outputAmount: string,
): Promise<{ ok: boolean; available: string; required: string; shortfall?: string }> {
  try {
    if (toChain === "SOL") {
      const kp = getSolKeypair();
      const conn = new Connection(SOLANA_DEVNET_RPC, "confirmed");
      const balance = await conn.getBalance(kp.publicKey);

      const RENT_EXEMPT_BUFFER = 1_200_000;
      const FEE_RESERVE        =    10_000;
      const required = Math.floor(parseFloat(outputAmount) * 1e9);
      const available = Math.max(0, balance - RENT_EXEMPT_BUFFER - FEE_RESERVE);

      const ok = available >= required;
      return {
        ok,
        available: (available / 1e9).toFixed(6),
        required:  (required  / 1e9).toFixed(6),
        shortfall: ok ? undefined : ((required - available) / 1e9).toFixed(6),
      };
    }

    if (["ETH", "BASE", "ARB"].includes(toChain)) {
      const wallet = getEthWallet();
      const rpcUrl = toChain === "ETH" ? SEPOLIA_RPC
        : toChain === "BASE" ? BASE_SEPOLIA_RPC
        : ARB_SEPOLIA_RPC;
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const balance  = await provider.getBalance(wallet.address);

      const feeData  = await provider.getFeeData();
      const gasCost  = (feeData.maxFeePerGas ?? ethers.parseUnits("20", "gwei")) * 21000n;
      const gasBuffer = gasCost * 2n;

      let required: bigint;
      try { required = ethers.parseEther(outputAmount); }
      catch { required = 0n; }

      const available = balance > gasBuffer ? balance - gasBuffer : 0n;
      const ok = available >= required;
      return {
        ok,
        available: ethers.formatEther(available),
        required:  ethers.formatEther(required),
        shortfall: ok ? undefined : ethers.formatEther(required - available),
      };
    }

    // Unsupported chain — fail closed to avoid unverified escrow lock
    process.stderr.write(`[checkSolverCanFulfill] unsupported chain "${toChain}" — failing closed\n`);
    return { ok: false, available: "unsupported_chain", required: outputAmount };
  } catch (e) {
    // Fail closed on RPC/check error: do not lock escrow when inventory cannot be verified.
    // Caller receives 503 so the user can retry once connectivity is restored.
    process.stderr.write(`[checkSolverCanFulfill] check error for ${toChain}: ${(e as Error).message?.slice(0, 80)} — failing closed\n`);
    return { ok: false, available: "check_error", required: outputAmount };
  }
}

// ─── Auto-register Live Solver on startup ─────────────────────────────────────

export function autoRegisterLiveSolver(): void {
  // Don't re-register if already exists
  const existing = getAllCustomSolvers().find(s => s.id === LIVE_SOLVER_ID || s.name.includes("Live Solver"));
  if (existing) return;

  const addrs = getLiveSolverAddresses();

  registerSolver({
    name: "🟢 Live Solver (Private Intent)",
    description: `Real testnet solver — actual on-chain execution. SOL:${addrs.sol.slice(0, 8)}… ETH:${addrs.eth.slice(0, 8)}…`,
    operatorAddress: addrs.eth,
    baseFeePercent: 0.10,
    supportedFromChains: ["SOL", "ETH"],
    supportedToChains: ["SOL", "ETH"],
    strategy: "Ultra-low fee solver that executes REAL testnet transactions. Delivery proven on-chain with actual tx hashes.",
  });

  process.stdout.write(`[LiveSolver] Auto-registered. SOL=${addrs.sol} ETH=${addrs.eth}\n`);
}
