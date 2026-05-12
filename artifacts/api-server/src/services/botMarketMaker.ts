/**
 * Dark Pool Market Maker Bot
 *
 * Seeds the order book at startup and refreshes every 12 minutes.
 * When a user matches with a bot order, the bot attempts real on-chain settlement:
 *   - SOL devnet: SystemProgram.transfer from bot wallet to user's phantomPubkey
 *   - ETH Sepolia: ethers Wallet.sendTransaction to user's ethAddress
 *   - PYUSD matches: recorded in-memory only (SPL transfers out of scope)
 *
 * Keypairs are HARDCODED — never regenerated across restarts.
 */

import {
  Connection, Keypair, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL, PublicKey,
} from "@solana/web3.js";
import { ethers } from "ethers";
import { randomBytes, createHash } from "crypto";
import { orderBook } from "../routes/darkpool.js";
import type { DPOrder } from "../routes/darkpool.js";
import { getRateSync } from "./liveRates.js";

// Solana memo program (SPL Memo v1)
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

// ── RPC endpoints ─────────────────────────────────────────────────────────────

const SOL_RPC  = "https://api.devnet.solana.com";
const ETH_RPC  = "https://ethereum-sepolia.publicnode.com";

// ── Hardcoded bot keypairs (DO NOT REGENERATE) ────────────────────────────────

// SOL: full 64-byte tweetnacl secretKey = seed (32 bytes) || publicKey (32 bytes)
const RAW_SOL_SECRETS: Record<string, string> = {
  "BOT-SOL-A": "dae6d171be15ca2ff8c05947871226067e462323329fa5af1612190523aeb86c380befa2f6fab331c7303ce563c236747791f53a198d9929a32bc2546db8c06a",
  "BOT-SOL-B": "e5463d4dd7dd4e92a0b860b461ca423f5a7bc04569637f93c4c285d091e94cda245993204a24664a9b3c3cb720b26d5c492a92fa02962ce94db0e0ab3e9037be",
  "BOT-SOL-C": "33bcddd6e15004b26cc1d78fb49e7f788adc653b5eaf2e835a9dbc4196142f07cf8b4d89bb999597c85e32489bc22d1dc5f52db3bf673324f1484722dea45d82",
};

const RAW_ETH_KEYS: Record<string, string> = {
  "BOT-ETH-D": "0x6306743d21c85ab0390053a54410dcecdddf7d73778e5b403cbd716444603613",
  "BOT-ETH-E": "0x9dc74073d704cfd4278a440929b7f4b85967788a0b7ce8aa60d5a9cf32124066",
};

// ── Initialise keypairs ───────────────────────────────────────────────────────

export const BOT_SOL_KEYPAIRS: Record<string, Keypair> = {};
for (const [name, secretHex] of Object.entries(RAW_SOL_SECRETS)) {
  BOT_SOL_KEYPAIRS[name] = Keypair.fromSecretKey(Buffer.from(secretHex, "hex"));
}

export const BOT_ETH_WALLETS: Record<string, ethers.Wallet> = {};
for (const [name, privKey] of Object.entries(RAW_ETH_KEYS)) {
  BOT_ETH_WALLETS[name] = new ethers.Wallet(privKey);
}

// ── Canonical address table ───────────────────────────────────────────────────

export interface BotAddress {
  name: string;
  chain: "SOL" | "ETH";
  network: "devnet" | "Sepolia";
  address: string;
}

export const BOT_ADDRESSES: BotAddress[] = [
  { name: "BOT-SOL-A", chain: "SOL", network: "devnet",  address: BOT_SOL_KEYPAIRS["BOT-SOL-A"]!.publicKey.toBase58() },
  { name: "BOT-SOL-B", chain: "SOL", network: "devnet",  address: BOT_SOL_KEYPAIRS["BOT-SOL-B"]!.publicKey.toBase58() },
  { name: "BOT-SOL-C", chain: "SOL", network: "devnet",  address: BOT_SOL_KEYPAIRS["BOT-SOL-C"]!.publicKey.toBase58() },
  { name: "BOT-ETH-D", chain: "ETH", network: "Sepolia", address: BOT_ETH_WALLETS["BOT-ETH-D"]!.address },
  { name: "BOT-ETH-E", chain: "ETH", network: "Sepolia", address: BOT_ETH_WALLETS["BOT-ETH-E"]!.address },
];

// Map pubkey/address → bot name for quick lookup
const SOL_PUBKEY_TO_BOT: Record<string, string> = {};
for (const b of BOT_ADDRESSES.filter(b => b.chain === "SOL")) {
  SOL_PUBKEY_TO_BOT[b.address] = b.name;
}
const ETH_ADDR_TO_BOT: Record<string, string> = {};
for (const b of BOT_ADDRESSES.filter(b => b.chain === "ETH")) {
  ETH_ADDR_TO_BOT[b.address.toLowerCase()] = b.name;
}

// ── Seed order profile (8 orders, randomised amounts within range) ─────────────

interface BotSeedProfile {
  botName: string;
  side: "buy" | "sell";
  tokenIn: string;
  tokenOut: string;
  minAmt: number;
  maxAmt: number;
}

const SEED_PROFILES: BotSeedProfile[] = [
  { botName: "BOT-SOL-A", side: "sell", tokenIn: "SOL",   tokenOut: "PYUSD", minAmt: 0.3,   maxAmt: 0.8 },
  { botName: "BOT-SOL-A", side: "buy",  tokenIn: "PYUSD", tokenOut: "SOL",   minAmt: 10,    maxAmt: 30 },
  { botName: "BOT-SOL-B", side: "sell", tokenIn: "SOL",   tokenOut: "ETH",   minAmt: 0.5,   maxAmt: 1.5 },
  { botName: "BOT-SOL-B", side: "buy",  tokenIn: "ETH",   tokenOut: "SOL",   minAmt: 0.001, maxAmt: 0.005 },
  { botName: "BOT-SOL-C", side: "sell", tokenIn: "PYUSD", tokenOut: "ETH",   minAmt: 20,    maxAmt: 80 },
  { botName: "BOT-SOL-C", side: "buy",  tokenIn: "ETH",   tokenOut: "PYUSD", minAmt: 0.002, maxAmt: 0.008 },
  { botName: "BOT-ETH-D", side: "sell", tokenIn: "ETH",   tokenOut: "PYUSD", minAmt: 0.005, maxAmt: 0.02 },
  { botName: "BOT-ETH-E", side: "buy",  tokenIn: "PYUSD", tokenOut: "ETH",   minAmt: 5,     maxAmt: 25 },
];

function randInRange(min: number, max: number): number {
  const r = parseInt(randomBytes(4).toString("hex"), 16) / 0xFFFFFFFF;
  return parseFloat((min + r * (max - min)).toFixed(6));
}

function botPubkey(botName: string): string {
  if (BOT_SOL_KEYPAIRS[botName]) return BOT_SOL_KEYPAIRS[botName]!.publicKey.toBase58();
  if (BOT_ETH_WALLETS[botName])  return BOT_ETH_WALLETS[botName]!.address;
  throw new Error(`Unknown bot: ${botName}`);
}

function makeEncHash(seed: string): string {
  return createHash("sha256").update(seed).digest("hex").slice(0, 12);
}

// ── seedDarkPool ──────────────────────────────────────────────────────────────

export function seedDarkPool(): void {
  for (const p of SEED_PROFILES) {
    const id      = randomBytes(16).toString("hex");
    const pubkey  = botPubkey(p.botName);
    const encHash = makeEncHash(`${p.botName}:${id}:${Date.now()}`);
    const order: DPOrder = {
      id,
      phantomPubkey: pubkey,
      side: p.side,
      tokenIn: p.tokenIn,
      tokenOut: p.tokenOut,
      amount: randInRange(p.minAmt, p.maxAmt),
      status: "open",
      encHash,
      ts: Date.now(),
      isMarketMaker: true,
    };
    orderBook.set(id, order);
  }
  process.stdout.write(`[BotMM] Seeded ${SEED_PROFILES.length} bot orders into dark pool\n`);
}

// ── refreshBotOrders (every 12 min) ──────────────────────────────────────────

export function refreshBotOrders(): void {
  let removed = 0;
  for (const [id, o] of orderBook) {
    if (o.isMarketMaker && o.status === "open") {
      orderBook.delete(id);
      removed++;
    }
  }
  seedDarkPool();
  process.stdout.write(`[BotMM] refresh — ${removed} orders replaced\n`);
}

// ── On-chain settlement ───────────────────────────────────────────────────────

export interface SettlementResult {
  settled: boolean;
  settlementTx?: string;
  settlementChain?: string;
  settlementAmount?: number;   // actual amount sent on-chain (in settlement token)
  settlementToken?: string;    // token transferred (SOL or ETH)
  reason?: string;
}

/**
 * Convert an amount denominated in `fromToken` to the settlement token.
 * Uses cached live rates; falls back to rate=1 if unavailable.
 */
function toSettlementAmount(amount: number, fromToken: string, settlementToken: string): number {
  if (fromToken === settlementToken) return amount;
  const rate = getRateSync(fromToken, settlementToken);
  return parseFloat((amount * rate).toFixed(9));
}

/**
 * Attempt on-chain settlement when a bot order is matched with a real user.
 * Settlement chain is determined by BOT IDENTITY, not by tokenIn:
 *   SOL bots  → always attempt SOL devnet SystemProgram.transfer + memo
 *   ETH bots  → always attempt ETH Sepolia Wallet.sendTransaction
 * Amount is normalized from botOrder.tokenIn units to settlement token units.
 * botOrder  — the bot's order (isMarketMaker = true)
 * userOrder — the real user's order
 */
export async function settleOnChain(
  botOrder: DPOrder,
  userOrder: DPOrder,
): Promise<SettlementResult> {
  const botPubkeyStr = botOrder.phantomPubkey;

  // ── SOL devnet settlement (SOL bot identity) ───────────────────────────────
  const solBotName = SOL_PUBKEY_TO_BOT[botPubkeyStr];
  if (solBotName) {
    const kp = BOT_SOL_KEYPAIRS[solBotName]!;

    // Normalize bot order amount → SOL; then take min with user's SOL-equivalent
    const botSol  = toSettlementAmount(botOrder.amount, botOrder.tokenIn, "SOL");
    const userSol = toSettlementAmount(userOrder.amount, userOrder.tokenIn, "SOL");
    const matchedSol = parseFloat(Math.min(botSol, userSol).toFixed(9));
    const lamports   = Math.floor(matchedSol * LAMPORTS_PER_SOL);

    if (lamports <= 0) {
      return { settled: false, reason: `Matched SOL amount too small (${matchedSol} SOL)` };
    }

    try {
      const conn    = new Connection(SOL_RPC, "confirmed");
      const balance = await conn.getBalance(kp.publicKey);
      const needed  = lamports + 10_000; // fee buffer
      if (balance < needed) {
        process.stdout.write(
          `[BotMM] WARN: ${solBotName} balance ${balance} lamports insufficient for ${lamports} + fee — match recorded without on-chain settlement\n`
        );
        return { settled: false, reason: `Insufficient balance (${balance} lamports)` };
      }

      // Memo encodes match provenance for on-chain proof
      const memoText = `prism-darkpool:${solBotName}:${botOrder.id.slice(0, 8)}:${userOrder.id.slice(0, 8)}`;
      const memoIx = new TransactionInstruction({
        keys: [],
        programId: MEMO_PROGRAM_ID,
        data: Buffer.from(memoText, "utf8"),
      });

      const tx = new Transaction().add(memoIx).add(
        SystemProgram.transfer({
          fromPubkey: kp.publicKey,
          toPubkey: new PublicKey(userOrder.phantomPubkey),
          lamports,
        })
      );

      const sig = await sendAndConfirmTransaction(conn, tx, [kp], { commitment: "confirmed" });
      process.stdout.write(
        `[BotMM] SOL settlement OK — ${solBotName} → ${userOrder.phantomPubkey} ${matchedSol} SOL | memo="${memoText}" | sig=${sig}\n`
      );
      return {
        settled: true, settlementTx: sig, settlementChain: "SOL devnet",
        settlementAmount: matchedSol, settlementToken: "SOL",
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`[BotMM] SOL settlement failed — ${msg}\n`);
      return { settled: false, reason: msg };
    }
  }

  // ── ETH Sepolia settlement (ETH bot identity) ──────────────────────────────
  const ethBotName = ETH_ADDR_TO_BOT[botPubkeyStr.toLowerCase()];
  if (ethBotName) {
    const wallet = BOT_ETH_WALLETS[ethBotName]!;

    // Determine destination: prefer ethAddress on user order, fall back to phantomPubkey
    const dest = userOrder.ethAddress ?? userOrder.phantomPubkey;
    if (!ethers.isAddress(dest)) {
      return { settled: false, reason: `No valid ETH address for user (got: ${dest})` };
    }

    // Normalize amounts → ETH; take min
    const botEth  = toSettlementAmount(botOrder.amount, botOrder.tokenIn, "ETH");
    const userEth = toSettlementAmount(userOrder.amount, userOrder.tokenIn, "ETH");
    const matchedEth = parseFloat(Math.min(botEth, userEth).toFixed(9));
    const weiAmt = ethers.parseEther(String(matchedEth));

    try {
      const provider  = new ethers.JsonRpcProvider(ETH_RPC);
      const connected = wallet.connect(provider);

      const balance = await provider.getBalance(wallet.address);
      const gasEst  = 21000n * ethers.parseUnits("30", "gwei"); // 21000 gas × 30 gwei = 630000000000 wei
      if (balance < weiAmt + gasEst) {
        process.stdout.write(
          `[BotMM] WARN: ${ethBotName} balance ${ethers.formatEther(balance)} ETH insufficient — match recorded without on-chain settlement\n`
        );
        return { settled: false, reason: `Insufficient balance (${ethers.formatEther(balance)} ETH)` };
      }

      const txResp = await connected.sendTransaction({ to: dest, value: weiAmt });
      process.stdout.write(
        `[BotMM] ETH settlement submitted — ${ethBotName} → ${dest} ${matchedEth} ETH | hash=${txResp.hash}\n`
      );
      return {
        settled: true, settlementTx: txResp.hash, settlementChain: "ETH Sepolia",
        settlementAmount: matchedEth, settlementToken: "ETH",
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`[BotMM] ETH settlement failed — ${msg}\n`);
      return { settled: false, reason: msg };
    }
  }

  return { settled: false, reason: "Bot pubkey not found in registry" };
}

// ── Funding table (printed at startup) ───────────────────────────────────────

export function printFundingTable(): void {
  const line = "═".repeat(72);
  process.stdout.write(`\n╔${line}╗\n`);
  process.stdout.write(`║${"  DARK POOL MARKET MAKER BOT — FUND THESE FOR ON-CHAIN SETTLEMENT  ".padEnd(72)}║\n`);
  process.stdout.write(`╠${line}╣\n`);
  for (const b of BOT_ADDRESSES) {
    const tag   = `  ${b.name.padEnd(12)} (${b.chain} ${b.network}):`;
    const row   = `${tag}  ${b.address}`;
    process.stdout.write(`║${row.padEnd(72)}║\n`);
  }
  process.stdout.write(`╚${line}╝\n\n`);
}
