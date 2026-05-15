/**
 * Live Rates Service
 *
 * Fetches real SOL + ETH spot prices from CoinGecko (free tier, no API key).
 * PYUSD is a stablecoin pegged to $1.00 USD — no fetch needed.
 * Results cached 60 s to stay within CoinGecko rate limits.
 *
 * Supported tokens: SOL (Devnet) · ETH (Sepolia) · PYUSD (both chains)
 * NOT supported: BTC (not used in this hackathon — devnet only)
 */

export interface LivePrices {
  SOL:   number;
  ETH:   number;
  PYUSD: number; // always 1.00 — stablecoin
}

export interface RateCache {
  prices: LivePrices;
  rates: Record<string, Record<string, number>>;
  fetchedAt: number;
  source: "coingecko" | "stale" | "fallback";
}

const CACHE_TTL_MS = 60_000;
const FALLBACK_PRICES: LivePrices = { SOL: 150, ETH: 2650, PYUSD: 1 };

let _cache: RateCache | null = null;

function buildRates(p: LivePrices): Record<string, Record<string, number>> {
  return {
    SOL: {
      ETH:   p.SOL / p.ETH,
      PYUSD: p.SOL,               // 1 SOL ≈ SOL_USD PYUSD
      SOL:   1,
    },
    ETH: {
      SOL:   p.ETH / p.SOL,
      PYUSD: p.ETH,               // 1 ETH ≈ ETH_USD PYUSD
      ETH:   1,
    },
    PYUSD: {
      SOL:   1 / p.SOL,           // 1 PYUSD ≈ 1/SOL_USD SOL
      ETH:   1 / p.ETH,           // 1 PYUSD ≈ 1/ETH_USD ETH
      PYUSD: 0.9975,              // cross-chain PYUSD bridge: ~0.25% slip
    },
  };
}

async function fetchFromCoinGecko(): Promise<{ SOL: number; ETH: number }> {
  const resp = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=solana,ethereum&vs_currencies=usd",
    {
      headers: { Accept: "application/json", "User-Agent": "private-intent-hackathon/1.0" },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!resp.ok) throw new Error(`CoinGecko HTTP ${resp.status}`);
  const data = (await resp.json()) as { solana?: { usd: number }; ethereum?: { usd: number } };
  const SOL = data.solana?.usd;
  const ETH = data.ethereum?.usd;
  if (!SOL || !ETH) throw new Error("CoinGecko returned incomplete price data");
  return { SOL, ETH };
}

export async function getLiveRates(): Promise<RateCache> {
  const now = Date.now();
  if (_cache && now - _cache.fetchedAt < CACHE_TTL_MS) return _cache;

  try {
    const { SOL, ETH } = await fetchFromCoinGecko();
    const prices: LivePrices = { SOL, ETH, PYUSD: 1 };
    process.stdout.write(`[LiveRates] CoinGecko SOL=$${SOL} ETH=$${ETH} PYUSD=$1.00 (stablecoin)\n`);
    _cache = { prices, rates: buildRates(prices), fetchedAt: now, source: "coingecko" };
    return _cache;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[LiveRates] CoinGecko fetch failed (${msg.slice(0, 80)})\n`);
    if (_cache) return { ..._cache, source: "stale" };
    process.stderr.write("[LiveRates] No cache — using fallback prices\n");
    _cache = { prices: FALLBACK_PRICES, rates: buildRates(FALLBACK_PRICES), fetchedAt: now, source: "fallback" };
    return _cache;
  }
}

/** Synchronous rate lookup — uses cached value, fallback if not yet loaded. */
export function getRateSync(from: string, to: string): number {
  const rates = _cache?.rates ?? buildRates(FALLBACK_PRICES);
  return rates[from]?.[to] ?? 1;
}

/** Synchronous USD price lookup */
export function getPriceSync(symbol: string): number {
  if (symbol === "PYUSD") return 1;
  const prices = _cache?.prices ?? FALLBACK_PRICES;
  return (prices as unknown as Record<string, number>)[symbol] ?? 1;
}

/** Warm the cache on startup (call once at boot, non-fatal) */
export function warmRatesCache(): void {
  getLiveRates().catch((e: Error) =>
    process.stderr.write(`[LiveRates] warm failed: ${e.message}\n`),
  );
}
