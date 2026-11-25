import { env } from "../src/config/env.js";
import { getInstruments, resolveIndexInstrument } from "../src/broker/instrumentMaster.js";
import { fetchHistoricalCandles, type KiteCredentials } from "../src/broker/kiteClient.js";
import { completedCandles, istDateKey } from "../src/application/marketClock.js";
import { supertrend } from "../src/indicators/indicators.js";
import type { Candle } from "../src/domain/types.js";

const TZ = "Asia/Kolkata";
const targetDate = process.argv[2] ?? istDateKey(new Date(), TZ);
const creds: KiteCredentials = { apiKey: env.KITE_API_KEY ?? "", accessToken: env.KITE_ACCESS_TOKEN };
const toCandle = (k: { timestamp: string; open: number; high: number; low: number; close: number; volume: number }): Candle =>
  ({ timestamp: k.timestamp, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume, complete: true });

const now = new Date();
const from = new Date(now.getTime() - 10 * 86400e3);

for (const symbol of ["NIFTY", "SENSEX"] as const) {
  const ex = symbol === "NIFTY" ? "NSE" : "BSE";
  const [master] = await Promise.all([getInstruments(creds, ex)]);
  const index = resolveIndexInstrument(master, symbol);
  const all = completedCandles(
    (await fetchHistoricalCandles(creds, index.instrumentToken, "15minute", from, now, false, TZ)).map(toCandle),
    15, now,
  );
  const today = all.filter((c) => istDateKey(new Date(Date.parse(c.timestamp) + 15 * 60_000), TZ) === targetDate);
  console.log(`\n=== ${symbol} ${targetDate} — ST(14,3) per candle ===`);
  let prev: string | null = null;
  for (const c of today) {
    const idx = all.indexOf(c);
    const st = supertrend(all.slice(0, idx + 1), 14, 3);
    const stPrev = prev;
    const end = new Date(Date.parse(c.timestamp) + 15 * 60_000);
    const hm = end.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
    const flip = stPrev && st && st !== stPrev ? `  <-- FLIP -> ${st === "BULLISH" ? "BUY_CALL" : "BUY_PUT"}` : "";
    if (st) prev = st;
    console.log(`${hm} close=${c.close.toFixed(1)} ST=${st ?? "-"}${flip}`);
  }
}
