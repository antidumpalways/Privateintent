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
import { getSentinelKeypair } from "./solanaBroadcast.js";
import { registerSolver, getAllCustomSolvers } from "./customSolverRegistry.js";

// Custom BTC signer using noble/curves secp256k1 directly (no ECPair needed)
function makeBtcSigner(privKeyBytes: Buffer): { publicKey: Buffer; sign(hash: Buffer): Buffer } {
  const compressedPubkey = Buffer.from(secp256k1.getPublicKey(privKeyBytes, true));
  return {
    publicKey: compressedPubkey,
    sign(hash: Buffer): Buffer {
      const sig = secp256k1.sign(hash, privKeyBytes, { lowS: true });
      return Buffer.from(sig.toDERRawBytes());
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

let _ethWallet: ethers.Wallet | null = null;

function getEthWallet(): ethers.Wallet {
  if (_ethWallet) return _ethWallet;

  // 1. Prefer env var — persists across restarts
  // Supports both SOLVER_ETH_PRIVATE_KEY (general) and ETH_SOLVER_PRIVATE_KEY (legacy/replit)
  const ethPk = (process.env.SOLVER_ETH_PRIVATE_KEY || process.env.ETH_SOLVER_PRIVATE_KEY)?.trim();
  if (ethPk) {
    _ethWallet = new ethers.Wallet(ethPk);
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
  _ethWallet = ethers.Wallet.createRandom();
  try {
    writeFileSync(ETH_WALLET_PATH, JSON.stringify({ pk: _ethWallet.privateKey }), { mode: 0o600 });
  } catch { /* persistence non-fatal */ }

  process.stdout.write(`[LiveSolver] ETH wallet generated: ${_ethWallet.address}\n`);
  process.stdout.write(`[LiveSolver] Fund with Sepolia ETH at https://sepoliafaucet.com: ${_ethWallet.address}\n`);
  return _ethWallet;
}

function getSolKeypair(): Keypair {
  return getSentinelKeypair();
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

  // Ensure solver is funded — auto-airdrop if needed
  let balance = await conn.getBalance(kp.publicKey);
  if (balance < 500_000) {
    process.stdout.write(`[LiveSolver/SOL] balance low (${balance} lamports) — auto-airdrop…\n`);
    try {
      const sig = await conn.requestAirdrop(kp.publicKey, 1_000_000_000);
      await conn.confirmTransaction(sig, "confirmed");
      balance = await conn.getBalance(kp.publicKey);
    } catch (e) {
      process.stderr.write(`[LiveSolver/SOL] airdrop failed: ${(e as Error).message}\n`);
    }
  }

  if (balance < 20_000) {
    return {
      success: false, txHash: "", explorerUrl: "", chain: "SOL", network: "Devnet",
      fromAddress: from, toAddress: to, amount: amountStr, unit: "SOL",
      isReal: false, error: "Insufficient SOL balance. Airdrop rate-limited. Visit https://faucet.solana.com",
    };
  }

  let lamports = Math.floor(parseFloat(amountStr) * 1e9);
  if (lamports < 1) lamports = 10_000; // minimum dust for demo

  const maxSend = balance - 15_000; // leave gas
  if (lamports > maxSend) lamports = maxSend;

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

  if (!ethers.isAddress(to)) {
    return {
      success: false, txHash: "", explorerUrl: explorerBase, chain: chainLabel, network: networkLabel,
      fromAddress: from, toAddress: to, amount: amountStr, unit: "ETH",
      isReal: false, error: `Invalid or missing destination ETH address: "${to}". Ensure you have an ETH address set in your dWallet profile, or provide destinationAddress in the intent.`,
    };
  }
  const toAddr = to;
  try {
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
