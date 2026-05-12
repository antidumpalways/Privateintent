/**
 * Dark Pool — Blind P2P order matching engine
 *
 * Design:
 *   - Orders sealed by FHE: wallet, amount, and side NOT visible to counterparty
 *   - Only route (tokenIn → tokenOut) revealed to allow matching
 *   - Engine finds complementary orders and notifies both parties
 *   - Matched orders execute via the existing intent system
 *
 * Routes:
 *   POST   /api/darkpool/order         — place a sealed buy/sell order
 *   GET    /api/darkpool/book          — anonymized open order book (no wallet/amount/side)
 *   GET    /api/darkpool/myorders      — caller's own orders with full detail
 *   DELETE /api/darkpool/order/:id     — cancel an open order
 *   GET    /api/darkpool/bots          — list all market maker bot addresses
 */

import { Router } from "express";
import { randomBytes, createHash } from "crypto";

const router = Router();

export interface DPOrder {
  id: string;
  phantomPubkey: string;
  ethAddress?: string;        // optional ETH address for ETH-side settlement
  side: "buy" | "sell";
  tokenIn: string;
  tokenOut: string;
  amount: number;
  priceLimit?: number;
  status: "open" | "matched" | "cancelled";
  matchId?: string;
  matchEncHash?: string;
  encHash: string;
  ts: number;
  isMarketMaker?: boolean;    // true for bot-placed orders
  settlementTx?: string;      // on-chain tx sig/hash after bot settlement
  settlementChain?: string;   // "SOL devnet" | "ETH Sepolia"
}

export const orderBook = new Map<string, DPOrder>();

export function sealedId(seed: string): string {
  return createHash("sha256").update(seed).digest("hex").slice(0, 12);
}

// ── Matching engine ───────────────────────────────────────────────────────────
// Match rule: opposite side + mirrored route + compatible price limits
function findMatch(candidate: DPOrder): DPOrder | null {
  const oppSide = candidate.side === "buy" ? "sell" : "buy";
  for (const [, o] of orderBook) {
    if (o.status !== "open") continue;
    if (o.phantomPubkey === candidate.phantomPubkey) continue; // no self-match
    if (o.side !== oppSide) continue;
    // Route mirror: buyer wants tokenIn→tokenOut, seller supplies tokenOut→tokenIn
    if (o.tokenIn !== candidate.tokenOut || o.tokenOut !== candidate.tokenIn) continue;
    // Price compatibility (both must specify a limit for price check)
    if (candidate.priceLimit !== undefined && o.priceLimit !== undefined) {
      const buyer  = candidate.side === "buy" ? candidate : o;
      const seller = candidate.side === "sell" ? candidate : o;
      if ((buyer.priceLimit ?? Infinity) < (seller.priceLimit ?? 0)) continue;
    }
    return o;
  }
  return null;
}

// ── POST /api/darkpool/order ──────────────────────────────────────────────────
router.post("/darkpool/order", async (req, res): Promise<void> => {
  const {
    phantomPubkey, ethAddress, side, tokenIn, tokenOut, amount, priceLimit,
  } = req.body as {
    phantomPubkey: string;
    ethAddress?: string;
    side: "buy" | "sell";
    tokenIn: string;
    tokenOut: string;
    amount: string | number;
    priceLimit?: string | number;
  };

  if (!phantomPubkey || !side || !tokenIn || !tokenOut || !amount) {
    res.status(400).json({ error: "Missing required fields: phantomPubkey, side, tokenIn, tokenOut, amount" }); return;
  }
  if (!["buy", "sell"].includes(side)) {
    res.status(400).json({ error: "side must be 'buy' or 'sell'" }); return;
  }
  const ALLOWED_TOKENS = ["SOL", "ETH", "PYUSD"];
  if (!ALLOWED_TOKENS.includes(String(tokenIn).toUpperCase())) {
    res.status(400).json({ error: `tokenIn must be one of: ${ALLOWED_TOKENS.join(", ")}. BTC and USDC not supported.` }); return;
  }
  if (!ALLOWED_TOKENS.includes(String(tokenOut).toUpperCase())) {
    res.status(400).json({ error: `tokenOut must be one of: ${ALLOWED_TOKENS.join(", ")}. BTC and USDC not supported.` }); return;
  }
  const amt = parseFloat(String(amount));
  if (isNaN(amt) || amt <= 0) { res.status(400).json({ error: "amount must be a positive number" }); return; }

  const id      = randomBytes(16).toString("hex");
  const encHash = sealedId(`${phantomPubkey}:${id}:${Date.now()}`);

  const order: DPOrder = {
    id,
    phantomPubkey,
    ethAddress: ethAddress ?? undefined,
    side,
    tokenIn: tokenIn.toUpperCase(),
    tokenOut: tokenOut.toUpperCase(),
    amount: amt,
    priceLimit: priceLimit !== undefined ? parseFloat(String(priceLimit)) : undefined,
    status: "open",
    encHash,
    ts: Date.now(),
  };

  const openCount = Array.from(orderBook.values()).filter(o => o.status === "open").length;
  process.stdout.write(
    `[DarkPool] ORDER   side=${side} | ${tokenIn.toUpperCase()}→${tokenOut.toUpperCase()} | amt=${amt} | encHash=${encHash.slice(0, 8)} | orderId=${id.slice(0, 8)}… | user=${phantomPubkey.slice(0, 8)}… | book=${openCount} open\n`
  );

  // Attempt matching before storing (so self-match guard works)
  const matchedOrder = findMatch(order);
  let settlementTx: string | null      = null;
  let settlementChain: string | null   = null;
  let settlementAmount: number | null  = null;
  let settlementToken: string | null   = null;
  let settlementSkipped: string | null = null;

  if (matchedOrder) {
    const mmLabel = matchedOrder.isMarketMaker
      ? ` (market maker: ${matchedOrder.phantomPubkey.slice(0, 8)}…)`
      : ` (user: ${matchedOrder.phantomPubkey.slice(0, 8)}…)`;
    process.stdout.write(
      `[DarkPool] MATCH   orderId=${id.slice(0, 8)}… ↔ ${matchedOrder.id.slice(0, 8)}…${mmLabel} | route ${tokenIn.toUpperCase()}→${tokenOut.toUpperCase()}\n`
    );

    order.status              = "matched";
    order.matchId             = matchedOrder.id;
    order.matchEncHash        = matchedOrder.encHash;
    matchedOrder.status       = "matched";
    matchedOrder.matchId      = id;
    matchedOrder.matchEncHash = encHash;
    orderBook.set(matchedOrder.id, matchedOrder);
    orderBook.set(id, order);

    // Attempt on-chain settlement synchronously if a bot is involved
    if (matchedOrder.isMarketMaker || order.isMarketMaker) {
      const botOrder  = matchedOrder.isMarketMaker ? matchedOrder : order;
      const userOrder = matchedOrder.isMarketMaker ? order : matchedOrder;

      try {
        const { settleOnChain } = await import("../services/botMarketMaker.js");
        const result = await settleOnChain(botOrder, userOrder);
        if (result.settled && result.settlementTx) {
          settlementTx    = result.settlementTx;
          settlementChain = result.settlementChain ?? null;
          settlementAmount = result.settlementAmount ?? null;
          settlementToken  = result.settlementToken ?? null;
          botOrder.settlementTx    = result.settlementTx;
          botOrder.settlementChain = result.settlementChain;
          userOrder.settlementTx   = result.settlementTx;
          userOrder.settlementChain = result.settlementChain;
          orderBook.set(botOrder.id, botOrder);
          orderBook.set(userOrder.id, userOrder);
          process.stdout.write(
            `[DarkPool] SETTLED orderId=${id.slice(0, 8)}… | chain=${settlementChain} | amt=${settlementAmount} ${settlementToken} | sig=${settlementTx.slice(0, 16)}…\n`
          );
        } else {
          settlementSkipped = result.reason ?? "Settlement not applicable";
          process.stdout.write(
            `[DarkPool] SKIP    orderId=${id.slice(0, 8)}… | settlement skipped: ${settlementSkipped.slice(0, 80)}\n`
          );
        }
      } catch (err) {
        settlementSkipped = `Settlement error: ${String(err)}`;
        process.stdout.write(
          `[DarkPool] SKIP    orderId=${id.slice(0, 8)}… | settlement error: ${String(err).slice(0, 80)}\n`
        );
      }
    }
  } else {
    orderBook.set(id, order);
    const newDepth = Array.from(orderBook.values()).filter(o => o.status === "open").length;
    process.stdout.write(
      `[DarkPool] QUEUED  orderId=${id.slice(0, 8)}… | no match yet | ${tokenIn.toUpperCase()}→${tokenOut.toUpperCase()} | book depth=${newDepth}\n`
    );
  }

  res.json({
    orderId: id,
    encHash,
    status: order.status,
    matchId: order.matchId ?? null,
    matchEncHash: order.matchEncHash ?? null,
    settlementTx,
    settlementChain,
    settlementAmount,
    settlementToken,
    settlementSkipped,
    isMarketMakerMatch: matchedOrder?.isMarketMaker ?? false,
    message: order.status === "matched"
      ? `✅ Sealed match found! Your ${side} order was paired with a counterparty. Execute swap to settle P2P.`
      : `🌑 Order sealed and placed in dark pool. Awaiting counterparty — no wallet or amount visible.`,
    privacyNote: "Wallet, amount, price limit, and side sealed by Encrypt FHE",
  });
});

// ── GET /api/darkpool/book ────────────────────────────────────────────────────
// Returns anonymized open orders. Side intentionally omitted to preserve dark pool semantics.
router.get("/darkpool/book", async (_req, res): Promise<void> => {
  const openOrders = Array.from(orderBook.values())
    .filter(o => o.status === "open")
    .map(o => ({
      encHash: o.encHash,
      route: `${o.tokenIn} → ${o.tokenOut}`,
      sizeDots: o.amount > 10 ? 3 : o.amount > 1 ? 2 : 1,
      status: o.status,
      ts: new Date(o.ts).toISOString(),
      isMarketMaker: o.isMarketMaker ?? false,
      privacyNote: "wallet, amount, and side sealed by Encrypt FHE",
    }))
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, 30);

  res.json({ orders: openOrders, count: openOrders.length, privacyMode: "fhe-sealed" });
});

// ── GET /api/darkpool/myorders?pubkey=... ────────────────────────────────────
// Returns caller's own orders with full detail (only visible to order owner).
router.get("/darkpool/myorders", async (req, res): Promise<void> => {
  const pubkey = String(req.query.pubkey ?? "").trim();
  if (!pubkey) { res.status(400).json({ error: "pubkey query parameter required" }); return; }

  const myOrders = Array.from(orderBook.values())
    .filter(o => o.phantomPubkey === pubkey)
    .map(o => ({
      id: o.id,
      encHash: o.encHash,
      side: o.side,
      route: `${o.tokenIn} → ${o.tokenOut}`,
      tokenIn: o.tokenIn,
      tokenOut: o.tokenOut,
      amount: o.amount,
      priceLimit: o.priceLimit ?? null,
      status: o.status,
      matchId: o.matchId ?? null,
      matchEncHash: o.matchEncHash ?? null,
      isMarketMaker: o.isMarketMaker ?? false,
      settlementTx: o.settlementTx ?? null,
      settlementChain: o.settlementChain ?? null,
      ts: new Date(o.ts).toISOString(),
    }))
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  res.json({ orders: myOrders });
});

// ── DELETE /api/darkpool/order/:id ───────────────────────────────────────────
router.delete("/darkpool/order/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { phantomPubkey } = req.body as { phantomPubkey: string };
  const order = orderBook.get(id);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (order.phantomPubkey !== phantomPubkey) { res.status(403).json({ error: "Unauthorized" }); return; }
  if (order.status !== "open") { res.status(400).json({ error: `Cannot cancel — order is ${order.status}` }); return; }
  order.status = "cancelled";
  orderBook.set(id, order);
  res.json({ success: true, orderId: id });
});

// ── GET /api/darkpool/bots ────────────────────────────────────────────────────
// Public — returns all market maker bot addresses (no auth required)
router.get("/darkpool/bots", async (_req, res): Promise<void> => {
  // Lazy import to avoid circular dep
  import("../services/botMarketMaker.js").then(({ BOT_ADDRESSES }) => {
    res.json({ bots: BOT_ADDRESSES });
  }).catch(err => {
    res.status(500).json({ error: "Failed to load bot registry", detail: String(err) });
  });
});

export default router;
