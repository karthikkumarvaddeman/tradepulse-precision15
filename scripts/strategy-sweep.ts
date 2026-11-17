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
const candleEnd60 = (c: Candle) => Date.parse(c.timestamp) + 60 * 60_000;

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

function gapFade(dayCandles: Candle[], prevDayClose: number, evalIdx: number, minGap = 0.004): Action {
  if (dayCandles.length < 3 || evalIdx < 2) return null;
  const open = dayCandles[0]!.open;
  const gapPct = (open - prevDayClose) / prevDayClose;
  const cur = dayCandles[evalIdx]!.close;
  const prev = dayCandles[evalIdx - 1]!.close;
  // only fade while price is still on the gap side of prev close (target still ahead)
  if (gapPct > minGap && prev >= open && cur < open && cur > prevDayClose) return "BUY_PUT";
  if (gapPct < -minGap && prev <= open && cur > open && cur < prevDayClose) return "BUY_CALL";
  return null;
}

// outcome with explicit target price (gap-fill) instead of R-multiple
function simulateOutcomePx(dayCandles: Candle[], evalIdx: number, action: "BUY_CALL" | "BUY_PUT", entry: number, atr14: number, targetPx: number) {
  const dir = action === "BUY_CALL" ? 1 : -1;
  const stopDist = env.STOP_ATR_MULTIPLE * atr14;
  const stop = entry - dir * stopDist;
  let mfe = 0;
  for (let i = evalIdx + 1; i < dayCandles.length; i++) {
    const c = dayCandles[i]!;
    const fav = dir === 1 ? c.high - entry : entry - c.low;
    if (fav > mfe) mfe = fav;
    const hitStop = dir === 1 ? c.low <= stop : c.high >= stop;
    const hitTarget = dir === 1 ? c.high >= targetPx : c.low <= targetPx;
    if (hitStop) return { result: "LOSS" as const, pnl: dir * (stop - entry), mfe };
    if (hitTarget) return { result: "WIN" as const, pnl: dir * (targetPx - entry), mfe };
  }
  const exit = dayCandles.at(-1)!.close;
  return { result: "EOD" as const, pnl: dir * (exit - entry), mfe };
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

interface DayData { symbol: string; date: string; candles: Candle[]; atr14: number; futVwap: number; prevDayClose: number; trends: ("bull" | "bear" | null)[]; relVols: number[] }

// [name, entryFn, exitMode] — exitMode "atr" = 1.5R target, "prevclose" = gap-fill target
type Strat = [string, (d: DayData, i: number) => Action, ("atr" | "prevclose" | "comboauto")?];
const STRATEGIES: Strat[] = [
  ["VWAP-reclaim", (d, i) => vwapReclaim(d.candles, i, d.futVwap)],
  ["VWAP+1h-trend", (d, i) => { const a = vwapReclaim(d.candles, i, d.futVwap); return a && d.trends[i] === (a === "BUY_CALL" ? "bull" : "bear") ? a : null; }],
  ["VWAP+vol>=1.2", (d, i) => { const a = vwapReclaim(d.candles, i, d.futVwap); return a && d.relVols[i]! >= 1.2 ? a : null; }],
  ["VWAP+early(<13:00)", (d, i) => { const end = candleEnd(d.candles[i]!); const early = end.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }) <= "13:00"; const a = vwapReclaim(d.candles, i, d.futVwap); return early ? a : null; }],
  ["VWAP+trend+vol", (d, i) => { const a = vwapReclaim(d.candles, i, d.futVwap); return a && d.trends[i] === (a === "BUY_CALL" ? "bull" : "bear") && d.relVols[i]! >= 1.2 ? a : null; }],
  ["VWAP+buf0.1%", (d, i) => { const prev = d.candles[i - 1]!.close, cur = d.candles[i]!.close, buf = d.futVwap * 0.001;
    if (prev <= d.futVwap && cur > d.futVwap + buf) return "BUY_CALL";
    if (prev >= d.futVwap && cur < d.futVwap - buf) return "BUY_PUT";
    return null; }],
  ["VWAP+buf0.2%", (d, i) => { const prev = d.candles[i - 1]!.close, cur = d.candles[i]!.close, buf = d.futVwap * 0.002;
    if (prev <= d.futVwap && cur > d.futVwap + buf) return "BUY_CALL";
    if (prev >= d.futVwap && cur < d.futVwap - buf) return "BUY_PUT";
    return null; }],
  ["VWAP+buf0.1%+trend", (d, i) => { const prev = d.candles[i - 1]!.close, cur = d.candles[i]!.close, buf = d.futVwap * 0.001;
    let a: Action = null;
    if (prev <= d.futVwap && cur > d.futVwap + buf) a = "BUY_CALL";
    if (prev >= d.futVwap && cur < d.futVwap - buf) a = "BUY_PUT";
    return a && d.trends[i] === (a === "BUY_CALL" ? "bull" : "bear") ? a : null; }],
  ["VWAP+late(>13:00)", (d, i) => { const end = candleEnd(d.candles[i]!); const late = end.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }) >= "13:00"; const a = vwapReclaim(d.candles, i, d.futVwap); return late ? a : null; }],
  ["GapFade-0.4%-fill", (d, i) => gapFade(d.candles, d.prevDayClose, i, 0.004), "prevclose"],
  ["GapFade-0.6%-fill", (d, i) => gapFade(d.candles, d.prevDayClose, i, 0.006), "prevclose"],
  ["GapFade-0.8%-fill", (d, i) => gapFade(d.candles, d.prevDayClose, i, 0.008), "prevclose"],
  ["Combo-gap+vwap", (d, i) => gapFade(d.candles, d.prevDayClose, i, 0.004) ?? vwapReclaim(d.candles, i, d.futVwap), "comboauto"],
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
    // per-candle: 1h trend (last completed hourly candle before this candle's end) and futures rel volume vs day-so-far avg
    const trends: ("bull" | "bear" | null)[] = [];
    const relVols: number[] = [];
    let futVolSum = 0;
    for (let i = 0; i < candles.length; i++) {
      const end = candleEnd(candles[i]!);
      const h1 = spot1h.filter((c) => candleEnd60(c) <= end.getTime()).at(-1);
      trends.push(h1 ? (h1.close > h1.open ? "bull" : h1.close < h1.open ? "bear" : null) : null);
      const fv = futByTs.get(candles[i]!.timestamp)?.volume ?? 0;
      const avgSoFar = i > 0 ? futVolSum / i : 0;
      relVols.push(avgSoFar > 0 ? fv / avgSoFar : 1);
      futVolSum += fv;
    }
    days.push({ symbol, date, candles, atr14, futVwap, prevDayClose: prevClose, trends, relVols });
  }
}
console.log(`Trading days loaded: ${days.length}`);

for (const [name, fn, exitMode] of STRATEGIES) {
  let w = 0, l = 0, e = 0, pts = 0, signals = 0, mfes = 0;
  const dailyCounts = new Map<string, number>();
  const openDays = new Set<string>();
  const trades: string[] = [];
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
      const em = exitMode === "comboauto"
        ? (gapFade(d.candles, d.prevDayClose, i, 0.004) ? "prevclose" : "atr")
        : exitMode;
      const out = em === "prevclose"
        ? simulateOutcomePx(d.candles, i, action, entry, d.atr14, d.prevDayClose)
        : simulateOutcome(d.candles, i, action, entry, d.atr14);
      signals++; mfes += out.mfe;
      if (out.result === "WIN") w++; else if (out.result === "LOSS") l++; else e++;
      pts += out.pnl;
      const hhmm = end.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
      trades.push(`${d.date} ${hhmm} IST ${d.symbol} ${action} @${entry.toFixed(1)} -> ${out.result} ${out.pnl >= 0 ? "+" : ""}${out.pnl.toFixed(0)}pts (MFE +${out.mfe.toFixed(0)})`);
      openDays.add(posKey); // hold rest of day after first signal (conservative)
      void sigKey;
      break;
    }
  }
  console.log(`\n${name.padEnd(16)} signals=${String(signals).padStart(4)}  W=${w} L=${l} EOD=${e}  pts=${pts >= 0 ? "+" : ""}${pts.toFixed(0)}  avgMFE=+${(mfes / Math.max(1, signals)).toFixed(0)}`);
  for (const t of trades) console.log(`  ${t}`);
}
