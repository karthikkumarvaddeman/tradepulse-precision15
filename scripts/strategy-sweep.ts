import { env } from "../src/config/env.js";
import { getInstruments, resolveFuturesInstrument, resolveIndexInstrument } from "../src/broker/instrumentMaster.js";
import { fetchHistoricalCandles, type KiteCredentials, type KiteCandle } from "../src/broker/kiteClient.js";
import { buildFuturesIndicators, buildSpotIndicators15m } from "../src/application/snapshotBuilder.js";
import { isMarketOpen, isWithinEntryWindow } from "../src/application/marketClock.js";
import { atr } from "../src/indicators/indicators.js";
import { DEFAULTS } from "../src/config/defaults.js";
import type { Candle } from "../src/domain/types.js";

const TZ = "Asia/Kolkata";
const daysBack = Number(process.argv[2] ?? 180);
const rangeStart = new Date(Date.now() - daysBack * 86400e3);
const creds: KiteCredentials = { apiKey: env.KITE_API_KEY ?? "", accessToken: env.KITE_ACCESS_TOKEN };
const toCandle = (k: KiteCandle): Candle => ({ timestamp: k.timestamp, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume, complete: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dayKey = (t: Date) => t.toLocaleDateString("en-CA", { timeZone: TZ });
const candleEnd = (c: Candle) => new Date(Date.parse(c.timestamp) + 15 * 60_000);

async function fetchChunk(token: number, interval: string, from: Date, to: Date, oi: boolean): Promise<KiteCandle[]> {
  for (let a = 0; a < 6; a++) {
    try { return await fetchHistoricalCandles(creds, token, interval, from, to, oi, TZ); }
    catch (e) { if ((e as { status?: number }).status !== 429 || a === 5) throw e; await sleep(5000 * (a + 1)); }
  }
  return [];
}
async function fetchRange(token: number, interval: string, from: Date, to: Date, oi: boolean): Promise<KiteCandle[]> {
  const out: KiteCandle[] = []; const seen = new Set<string>();
  for (let s = from.getTime(); s < to.getTime(); s += 30 * 86400e3) {
    const e = new Date(Math.min(s + 30 * 86400e3, to.getTime()));
    for (const c of await fetchChunk(token, interval, new Date(s), e, oi)) {
      if (!seen.has(c.timestamp)) { seen.add(c.timestamp); out.push(c); }
    }
    await sleep(400);
  }
  return out.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

// ---- strategies: given day candles up to & incl. eval candle, return action or null ----
type Action = "BUY_CALL" | "BUY_PUT" | null;

function orb(dayCandles: Candle[], evalIdx: number): Action {
  if (dayCandles.length < 3 || evalIdx < 2) return null; // need range candle + trigger candle
  const range = dayCandles[0]!; // 09:15-09:30 candle defines range
  const prev = dayCandles[evalIdx - 1]!;
  const cur = dayCandles[evalIdx]!;
  if (cur.close > range.high && prev.close <= range.high) return "BUY_CALL";
  if (cur.close < range.low && prev.close >= range.low) return "BUY_PUT";
  return null;
}

function vwapReclaim(dayCandles: Candle[], evalIdx: number, futVwap: number): Action {
  if (evalIdx < 1) return null;
  const prev = dayCandles[evalIdx - 1]!.close;
  const cur = dayCandles[evalIdx]!.close;
  if (prev <= futVwap && cur > futVwap) return "BUY_CALL";
  if (prev >= futVwap && cur < futVwap) return "BUY_PUT";
  return null;
}

function gapFade(dayCandles: Candle[], prevDayClose: number, evalIdx: number): Action {
  if (dayCandles.length < 3 || evalIdx < 2) return null;
  const open = dayCandles[0]!.open;
  const gapPct = (open - prevDayClose) / prevDayClose;
  const cur = dayCandles[evalIdx]!.close;
  const prev = dayCandles[evalIdx - 1]!.close;
  if (gapPct > 0.004 && prev >= open && cur < open) return "BUY_PUT";   // gap up fading below open
  if (gapPct < -0.004 && prev <= open && cur > open) return "BUY_CALL"; // gap down reclaiming open
  return null;
}

function simulateOutcome(dayCandles: Candle[], evalIdx: number, action: "BUY_CALL" | "BUY_PUT", entry: number, atr14: number) {
  const dir = action === "BUY_CALL" ? 1 : -1;
  const stopDist = env.STOP_ATR_MULTIPLE * atr14;
  const stop = entry - dir * stopDist, target = entry + dir * env.TARGET_R_MULTIPLE * stopDist;
  let mfe = 0;
  for (let i = evalIdx + 1; i < dayCandles.length; i++) {
    const c = dayCandles[i]!;
    const fav = dir === 1 ? c.high - entry : entry - c.low;
    if (fav > mfe) mfe = fav;
    const hitStop = dir === 1 ? c.low <= stop : c.high >= stop;
    const hitTarget = dir === 1 ? c.high >= target : c.low <= target;
    if (hitStop) return { result: "LOSS" as const, pnl: dir * (stop - entry), mfe };
    if (hitTarget) return { result: "WIN" as const, pnl: dir * (target - entry), mfe };
  }
  const exit = dayCandles.at(-1)!.close;
  return { result: "EOD" as const, pnl: dir * (exit - entry), mfe };
}

interface DayData { symbol: string; date: string; candles: Candle[]; atr14: number; futVwap: number; relVol: number; prevDayClose: number }

const STRATEGIES: [string, (d: DayData, evalIdx: number) => Action][] = [
  ["ORB-15min", (d, i) => orb(d.candles, i)],
  ["VWAP-reclaim", (d, i) => vwapReclaim(d.candles, i, d.futVwap)],
  ["Gap-fade-0.4%", (d, i) => gapFade(d.candles, d.prevDayClose, i)],
];

const days: DayData[] = [];
for (const symbol of ["NIFTY", "SENSEX"] as const) {
  const spotEx = symbol === "NIFTY" ? "NSE" : "BSE";
  const futEx = symbol === "NIFTY" ? "NFO" : "BFO";
  const [spotMaster, futMaster] = await Promise.all([getInstruments(creds, spotEx), getInstruments(creds, futEx)]);
  const index = resolveIndexInstrument(spotMaster, symbol);
  const fut = resolveFuturesInstrument(futMaster, symbol, new Date());
  const fetchFrom = new Date(rangeStart.getTime() - 45 * 86400e3);
  const nowD = new Date();
  const [spot15, spot1h, fut15] = await Promise.all([
    fetchRange(index.instrumentToken, "15minute", fetchFrom, nowD, false).then((r) => r.map(toCandle)),
    fetchRange(index.instrumentToken, "60minute", new Date(rangeStart.getTime() - 60 * 86400e3), nowD, false).then((r) => r.map(toCandle)),
    fetchRange(fut.instrumentToken, "15minute", fetchFrom, nowD, true).then((r) => r.map(toCandle)),
  ]);
  console.log(`${symbol}: ${spot15.length}/${spot1h.length}/${fut15.length} candles`);
  void spot1h;
  // group spot candles by day
  const byDay = new Map<string, Candle[]>();
  for (const c of spot15) {
    const k = dayKey(candleEnd(c));
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(c);
  }
  const futByTs = new Map(fut15.map((c) => [c.timestamp, c]));
  const sortedDays = [...byDay.keys()].sort();
  for (let di = 0; di < sortedDays.length; di++) {
    const date = sortedDays[di]!;
    if (date < rangeStart.toLocaleDateString("en-CA", { timeZone: TZ })) continue;
    const candles = byDay.get(date)!;
    if (candles.length < 10) continue;
    // ATR from trailing spot candles before this day
    const dayStart = Date.parse(candles[0]!.timestamp);
    const hist = spot15.filter((c) => Date.parse(c.timestamp) + 15 * 60_000 <= dayStart).slice(-60);
    const atr14 = atr(hist) ?? 0;
    if (!(atr14 > 0)) continue;
    // futures VWAP/volume for each candle; use last candle's slot-adjusted volume vs day avg
    const futDay = candles.map((c) => futByTs.get(c.timestamp)).filter(Boolean) as Candle[];
    const futVwap = (() => {
      const tp = futDay.reduce((s, c) => s + ((c.high + c.low + c.close) / 3) * (c.volume || 1), 0);
      const v = futDay.reduce((s, c) => s + (c.volume || 1), 0);
      return v > 0 ? tp / v : 0;
    })();
    const prevClose = di > 0 ? byDay.get(sortedDays[di - 1]!)!.at(-1)!.close : candles[0]!.open;
    days.push({ symbol, date, candles, atr14, futVwap, relVol: 1, prevDayClose: prevClose });
  }
}
console.log(`Trading days loaded: ${days.length}`);

for (const [name, fn] of STRATEGIES) {
  let w = 0, l = 0, e = 0, pts = 0, signals = 0, mfes = 0;
  const dailyCounts = new Map<string, number>();
  const openDays = new Set<string>();
  for (const d of days) {
    const posKey = `${d.symbol}:${d.date}`;
    if (openDays.has(posKey)) continue; // one open position per symbol-day
    for (let i = 0; i < d.candles.length; i++) {
      const end = candleEnd(d.candles[i]!);
      if (!isMarketOpen(end, TZ) || !isWithinEntryWindow(end, TZ)) continue;
      // only evaluate once per candle; dedupe via "already signaled today" set
      const action = fn(d, i);
      if (!action) continue;
      const sigKey = `${posKey}:${i}`;
      if (dailyCounts.get(d.date)! >= DEFAULTS.maxDailySignals) break;
      dailyCounts.set(d.date, (dailyCounts.get(d.date) ?? 0) + 1);
      const entry = d.candles[i]!.close;
      const out = simulateOutcome(d.candles, i, action, entry, d.atr14);
      signals++; mfes += out.mfe;
      if (out.result === "WIN") w++; else if (out.result === "LOSS") l++; else e++;
      pts += out.pnl;
      openDays.add(posKey); // hold rest of day after first signal (conservative)
      void sigKey;
      break;
    }
  }
  console.log(`${name.padEnd(16)} signals=${String(signals).padStart(4)}  W=${w} L=${l} EOD=${e}  pts=${pts >= 0 ? "+" : ""}${pts.toFixed(0)}  avgMFE=+${(mfes / Math.max(1, signals)).toFixed(0)}`);
}
