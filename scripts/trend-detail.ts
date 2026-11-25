import { env } from "../src/config/env.js";
import { getInstruments, resolveFuturesInstrument, resolveIndexInstrument } from "../src/broker/instrumentMaster.js";
import { fetchHistoricalCandles, type KiteCredentials } from "../src/broker/kiteClient.js";
import { completedCandles, istDateKey } from "../src/application/marketClock.js";
import { ema, vwap } from "../src/indicators/indicators.js";
import type { Candle } from "../src/domain/types.js";

const TZ = "Asia/Kolkata";
const creds: KiteCredentials = { apiKey: env.KITE_API_KEY ?? "", accessToken: env.KITE_ACCESS_TOKEN };
const toCandle = (k: { timestamp: string; open: number; high: number; low: number; close: number; volume: number }): Candle =>
  ({ timestamp: k.timestamp, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume, complete: true });

const now = new Date();
const todayKey = istDateKey(now, TZ);

for (const symbol of ["NIFTY", "SENSEX"] as const) {
  const spotEx = symbol === "NIFTY" ? "NSE" : "BSE";
  const futEx = symbol === "NIFTY" ? "NFO" : "BFO";
  const [spotMaster, futMaster] = await Promise.all([getInstruments(creds, spotEx), getInstruments(creds, futEx)]);
  const index = resolveIndexInstrument(spotMaster, symbol);
  const fut = resolveFuturesInstrument(futMaster, symbol, now);
  const fromD = new Date(now.getTime() - 10 * 86400e3);
  const from1h = new Date(now.getTime() - 20 * 86400e3);
  const [d15, h1, f15] = await Promise.all([
    fetchHistoricalCandles(creds, index.instrumentToken, "15minute", fromD, now, false, TZ).then((r) => r.map(toCandle)),
    fetchHistoricalCandles(creds, index.instrumentToken, "60minute", from1h, now, false, TZ).then((r) => r.map(toCandle)),
    fetchHistoricalCandles(creds, fut.instrumentToken, "15minute", fromD, now, true, TZ).then((r) => r.map(toCandle)),
  ]);
  const s15 = completedCandles(d15, 15, now);
  const s1h = completedCandles(h1, 60, now);
  const f15c = completedCandles(f15, 15, now);

  const today15 = s15.filter((c) => istDateKey(new Date(Date.parse(c.timestamp) + 15 * 60_000), TZ) === todayKey);
  const todayFut = f15c.filter((c) => istDateKey(new Date(Date.parse(c.timestamp) + 15 * 60_000), TZ) === todayKey);
  const mon15 = s15.filter((c) => istDateKey(new Date(Date.parse(c.timestamp) + 15 * 60_000), TZ) === "2026-11-23");
  const last = today15.at(-1);
  const futVwap = vwap(todayFut);
  const e20_15 = ema(s15.map((c) => c.close), 20);
  const e20_1h = ema(s1h.map((c) => c.close), 20);
  const e50_1h = ema(s1h.map((c) => c.close), 50);
  const last1h = s1h.at(-1);

  const monHi = mon15.length ? Math.max(...mon15.map((c) => c.high)) : 0;
  const monLo = mon15.length ? Math.min(...mon15.map((c) => c.low)) : 0;
  const monClose = mon15.at(-1)?.close ?? 0;
  const posInMonRange = last && monHi > monLo ? ((last.close - monLo) / (monHi - monLo)) * 100 : 0;

  console.log(`\n=== ${symbol} trend structure ===`);
  console.log(`Monday range: ${monLo.toFixed(1)} – ${monHi.toFixed(1)} (close ${monClose.toFixed(1)})`);
  console.log(`Today: last ${last?.close.toFixed(1)} | position in Monday's range: ${posInMonRange.toFixed(0)}%`);
  console.log(`Futures session VWAP today: ${futVwap?.toFixed(1) ?? "-"} | spot vs VWAP: ${last && futVwap ? (last.close > futVwap ? "ABOVE" : "BELOW") : "-"}`);
  console.log(`15m EMA20: ${e20_15?.toFixed(1)} | price ${last && e20_15 ? (last.close > e20_15 ? "above" : "below") : "-"}`);
  console.log(`1h EMA20: ${e20_1h?.toFixed(1)} | 1h EMA50: ${e50_1h?.toFixed(1)} | last 1h candle ${last1h ? `${last1h.close > last1h.open ? "bullish" : "bearish"} (O${last1h.open.toFixed(0)} C${last1h.close.toFixed(0)})` : "-"}`);
  console.log(`1h structure: ${e20_1h && e50_1h ? (e20_1h > e50_1h ? "EMA20>EMA50 (bullish alignment)" : "EMA20<EMA50 (bearish alignment)") : "-"}`);
}
