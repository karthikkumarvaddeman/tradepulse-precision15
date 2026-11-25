import { env } from "../src/config/env.js";
import { getInstruments, resolveIndexInstrument, resolveFuturesInstrument } from "../src/broker/instrumentMaster.js";
import { fetchHistoricalCandles, type KiteCredentials } from "../src/broker/kiteClient.js";
import { completedCandles, istDateKey } from "../src/application/marketClock.js";
import { supertrend, vwap, ema } from "../src/indicators/indicators.js";
import type { Candle } from "../src/domain/types.js";

const TZ = "Asia/Kolkata";
const creds: KiteCredentials = { apiKey: env.KITE_API_KEY ?? "", accessToken: env.KITE_ACCESS_TOKEN };
const toCandle = (k: { timestamp: string; open: number; high: number; low: number; close: number; volume: number }): Candle =>
  ({ timestamp: k.timestamp, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume, complete: true });

const now = new Date();
const from = new Date(now.getTime() - 15 * 86400e3);

for (const symbol of ["NIFTY", "SENSEX"] as const) {
  const spotEx = symbol === "NIFTY" ? "NSE" : "BSE";
  const futEx = symbol === "NIFTY" ? "NFO" : "BFO";
  const [spotMaster, futMaster] = await Promise.all([getInstruments(creds, spotEx), getInstruments(creds, futEx)]);
  const index = resolveIndexInstrument(spotMaster, symbol);
  const fut = resolveFuturesInstrument(futMaster, symbol, now);
  const [dayRaw, min15] = await Promise.all([
    fetchHistoricalCandles(creds, index.instrumentToken, "day", from, now, false, TZ),
    fetchHistoricalCandles(creds, index.instrumentToken, "15minute", new Date(now.getTime() - 5 * 86400e3), now, false, TZ),
  ]);
  const days = dayRaw.map(toCandle).filter((c) => c.complete !== false);
  const m15 = completedCandles(min15.map(toCandle), 15, now);
  const todayKey = istDateKey(now, TZ);
  const today = m15.filter((c) => istDateKey(new Date(Date.parse(c.timestamp) + 15 * 60_000), TZ) === todayKey);
  const st = supertrend(m15, 14, 3);
  const closes15 = m15.map((c) => c.close);
  const e20 = ema(closes15, 20), e50 = ema(closes15, 50);

  console.log(`\n=== ${symbol} ===`);
  console.log("Daily candles:");
  for (const d of days.slice(-6)) {
    const key = istDateKey(new Date(Date.parse(d.timestamp) + 24 * 3600_000), TZ);
    const chg = d.open ? ((d.close - d.open) / d.open) * 100 : 0;
    console.log(`  ${key}  O=${d.open.toFixed(1)} H=${d.high.toFixed(1)} L=${d.low.toFixed(1)} C=${d.close.toFixed(1)}  (${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%)`);
  }
  if (today.length) {
    const o = today[0]!.open, last = today.at(-1)!;
    const hi = Math.max(...today.map((c) => c.high)), lo = Math.min(...today.map((c) => c.low));
    const prevClose = days.at(-2)?.close ?? 0;
    console.log(`Today: O=${o.toFixed(1)} H=${hi.toFixed(1)} L=${lo.toFixed(1)} last=${last.close.toFixed(1)}  vs prevClose ${prevClose ? ((last.close - prevClose) / prevClose * 100).toFixed(2) + "%" : "-"}`);
    console.log(`15m: candles=${today.length} ST=${st} EMA20=${e20?.toFixed(1)} EMA50=${e50?.toFixed(1)} priceVsEMA20=${last.close > (e20 ?? 0) ? "above" : "below"}`);
  }
  void fut;
}
