import { env } from "../src/config/env.js";
import { getInstruments, resolveIndexInstrument } from "../src/broker/instrumentMaster.js";
import { fetchHistoricalCandles, type KiteCredentials } from "../src/broker/kiteClient.js";
import { completedCandles, istDateKey } from "../src/application/marketClock.js";
import { supertrend, vwap } from "../src/indicators/indicators.js";
import type { Candle } from "../src/domain/types.js";

const TZ = "Asia/Kolkata";
const creds: KiteCredentials = { apiKey: env.KITE_API_KEY ?? "", accessToken: env.KITE_ACCESS_TOKEN };
const toCandle = (k: { timestamp: string; open: number; high: number; low: number; close: number; volume: number }): Candle =>
  ({ timestamp: k.timestamp, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume, complete: true });

const now = new Date();
const from = new Date(now.getTime() - 10 * 86400e3);
const todayKey = istDateKey(now, TZ);

for (const symbol of ["NIFTY", "SENSEX"] as const) {
  const ex = symbol === "NIFTY" ? "NSE" : "BSE";
  const [master] = await Promise.all([getInstruments(creds, ex)]);
  const index = resolveIndexInstrument(master, symbol);
  const raw = await fetchHistoricalCandles(creds, index.instrumentToken, "15minute", from, now, false, TZ);
  const all = completedCandles(raw.map(toCandle), 15, now);
  const byDay = new Map<string, Candle[]>();
  for (const c of all) {
    const k = istDateKey(new Date(Date.parse(c.timestamp) + 15 * 60_000), TZ);
    const arr = byDay.get(k) ?? [];
    arr.push(c);
    byDay.set(k, arr);
  }
  const days = [...byDay.keys()].sort();
  const di = days.indexOf(todayKey);
  const today = byDay.get(todayKey) ?? [];
  const prev = di > 0 ? byDay.get(days[di - 1]!) ?? [] : [];
  const prevClose = prev.at(-1)?.close ?? 0;
  const prevOpen = prev[0]?.open ?? 0;
  const open = today[0]?.open ?? 0;
  const last = today.at(-1);
  const st = supertrend(all, 14, 3);
  const dayVwap = vwap(today);
  const prevRet = prevOpen > 0 ? ((prevClose - prevOpen) / prevOpen) * 100 : 0;
  const dayChg = prevClose > 0 && last ? ((last.close - prevClose) / prevClose) * 100 : 0;
  const gap = prevClose > 0 && open ? ((open - prevClose) / prevClose) * 100 : 0;

  console.log(`\n=== ${symbol} — ${todayKey} ===`);
  console.log(`prev day (${days[di - 1] ?? "?"}): open ${prevOpen.toFixed(1)} → close ${prevClose.toFixed(1)} (${prevRet >= 0 ? "+" : ""}${prevRet.toFixed(2)}%)`);
  console.log(`today: open ${open.toFixed(1)} (gap ${gap >= 0 ? "+" : ""}${gap.toFixed(2)}%) | last close ${last?.close.toFixed(1) ?? "-"} (${dayChg >= 0 ? "+" : ""}${dayChg.toFixed(2)}% vs prev close)`);
  console.log(`day range: ${Math.min(...today.map((c) => c.low)).toFixed(1)} – ${Math.max(...today.map((c) => c.high)).toFixed(1)}`);
  console.log(`Supertrend(14,3): ${st ?? "-"} | spot VWAP today: ${dayVwap?.toFixed(1) ?? "-"} | price ${last && dayVwap ? (last.close > dayVwap ? "ABOVE" : "BELOW") : "-"} VWAP`);
  console.log(`candles today: ${today.length}`);
}
