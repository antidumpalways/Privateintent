/**
 * Live Rates API
 *
 * GET /api/rates — returns live SOL/ETH/BTC spot prices + cross-pair rates.
 * Backed by the shared liveRates service (CoinGecko, 60 s cache).
 */

import { Router } from "express";
import { getLiveRates } from "../services/liveRates.js";

export { getLiveRates };

const router = Router();

router.get("/rates", async (_req, res) => {
  try {
    const data = await getLiveRates();
    res.json({
      prices: data.prices,
      rates: data.rates,
      fetchedAt: new Date(data.fetchedAt).toISOString(),
      source: data.source,
      cacheTtlSeconds: 60,
      note: "Live prices from CoinGecko. Networks: SOL=Devnet ETH=Sepolia PYUSD=stablecoin($1)",
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
