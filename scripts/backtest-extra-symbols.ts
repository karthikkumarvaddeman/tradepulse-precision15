import { env } from "../src/config/env.js";
import { getInstruments, nearestExpiry, type Instrument } from "../src/broker/instrumentMaster.js";
import { fetchHistoricalCandles, type KiteCredentials, type KiteCandle } from "../src/broker/kiteClient.js";
import { atr } from "../src/indicators/indicators.js";
import { isMarketOpen, isWithinEntryWindow } from "../src/application/marketClock.js";
import { DEFAULTS } from "../src/config/defaults.js";
import type { Candle } from "../src/domain/types.js";

// Backtest-only script: evaluates gap-fade / VWAP / combo-late on symbols
// outside the default NIFTY+SENSEX live profile (BANKNIFTY, FINNIFTY).
// Does NOT touch the live engine or IndexSymbol union.

const TZ = "Asia/Kolkata";
const daysBack = Number(process.argv[2] ?? 180);
const rangeStart = new Date(Date.now() - daysBack * 86400e3);
const creds: KiteCredentials = { apiKey: env.KITE_API_KEY ?? "", accessToken: env.KITE_ACCESS_TOKEN };
const toCandle = (k: KiteCandle): Candle => ({ timestamp: k.timestamp, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume, complete: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dayKey = (t: Date) => t.toLocaleDateString("en-CA", { timeZone: TZ });
const candleEnd = (c: Candle) => new Date(Date.parse(c.timestamp) + 15 * 60_000);
const candleEndMin = (c: Candle) => {
  const e = candleEnd(c);
  const hm = e.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  const [h, m] = hm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

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

type Action = "BUY_CALL" | "BUY_PUT" | null;

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
  if (gapPct > minGap && prev >= open && cur < open && cur > prevDayClose) return "BUY_PUT";
  if (gapPct < -minGap && prev <= open && cur > open && cur < prevDayClose) return "BUY_CALL";
  return null;
}

function comboLate(dayCandles: Candle[], prevDayClose: number, evalIdx: number, futVwap: number): { action: Action; gapFill: boolean } {
  const open = dayCandles[0]?.open ?? 0;
  const isGapDay = prevDayClose > 0 && Math.abs((open - prevDayClose) / prevDayClose) > 0.004;
  if (isGapDay) {
    const a = gapFade(dayCandles, prevDayClose, evalIdx, 0.004);
    return { action: a, gapFill: true };
  }
  if (candleEndMin(dayCandles[evalIdx]!) < 13 * 60) return { action: null, gapFill: false };
  return { action: vwapReclaim(dayCandles, evalIdx, futVwap), gapFill: false };
}

function simulateOutcomePx(dayCandles: Candle[], evalIdx: number, action: "BUY_CALL" | "BUY_PUT", entry: number, atr14: number, targetPx: number) {
  const dir = action === "BUY_CALL" ? 1 : -1;
  const stopDist = env.STOP_ATR_MULTIPLE * atr14;
  const stop = entry - dir * stopDist;
  for (let i = evalIdx + 1; i < dayCandles.length; i++) {
    const c = dayCandles[i]!;
    const hitStop = dir === 1 ? c.low <= stop : c.high >= stop;
    const hitTarget = dir === 1 ? c.high >= targetPx : c.low <= targetPx;
    if (hitStop) return { result: "LOSS" as const, pnl: dir * (stop - entry) };
    if (hitTarget) return { result: "WIN" as const, pnl: dir * (targetPx - entry) };
  }
  const exit = dayCandles.at(-1)!.close;
  return { result: "EOD" as const, pnl: dir * (exit - entry) };
}

function simulateOutcome(dayCandles: Candle[], evalIdx: number, action: "BUY_CALL" | "BUY_PUT", entry: number, atr14: number) {
  const dir = action === "BUY_CALL" ? 1 : -1;
  const stopDist = env.STOP_ATR_MULTIPLE * atr14;
  const stop = entry - dir * stopDist, target = entry + dir * env.TARGET_R_MULTIPLE * stopDist;
  for (let i = evalIdx + 1; i < dayCandles.length; i++) {
    const c = dayCandles[i]!;
    const hitStop = dir === 1 ? c.low <= stop : c.high >= stop;
    const hitTarget = dir === 1 ? c.high >= target : c.low <= target;
    if (hitStop) return { result: "LOSS" as const, pnl: dir * (stop - entry) };
    if (hitTarget) return { result: "WIN" as const, pnl: dir * (target - entry) };
  }
  const exit = dayCandles.at(-1)!.close;
  return { result: "EOD" as const, pnl: dir * (exit - entry) };
}

interface SymCfg { label: string; futName: string; indexMatch: (i: Instrument) => boolean }
const STOCKS = ["RELIANCE","TCS","HDFCBANK","ICICIBANK","SBIN","INFY","LT","AXISBANK","KOTAKBANK","BAJFINANCE","MARUTI","SUNPHARMA"];
const SYMS: SymCfg[] = STOCKS.map((label) => ({
  label,
  futName: label,
  indexMatch: (i: Instrument) => i.tradingsymbol === label && i.instrumentType === "EQ",
}));

const [nse, nfo] = await Promise.all([getInstruments(creds, "NSE"), getInstruments(creds, "NFO")]);
const nowD = new Date();

const onlySyms = process.argv[3] ? process.argv[3].split(",") : null;
for (const sym of SYMS) {
  if (onlySyms && !onlySyms.includes(sym.label)) continue;
  const index = nse.find(sym.indexMatch);
  if (!index) { console.log(`${sym.label}: index instrument not found in NSE master`); continue; }
  const expiry = nearestExpiry(nfo, sym.futName, "NFO", nowD);
  const fut = nfo.find((i) => i.exchange === "NFO" && i.name === sym.futName && i.instrumentType === "FUT" && i.expiry === expiry);
  if (!fut) { console.log(`${sym.label}: futures not found for expiry ${expiry}`); continue; }
  console.log(`\n=== ${sym.label} === index=${index.tradingsymbol}(${index.instrumentToken}) futures=${fut.tradingsymbol} exp ${expiry}`);

  const fetchFrom = new Date(rangeStart.getTime() - 45 * 86400e3);
  const [spot15, fut15] = await Promise.all([
    fetchRange(index.instrumentToken, "15minute", fetchFrom, nowD, false).then((r) => r.map(toCandle)),
    fetchRange(fut.instrumentToken, "15minute", fetchFrom, nowD, true).then((r) => r.map(toCandle)),
  ]);
  console.log(`candles: spot=${spot15.length} fut=${fut15.length}`);

  const byDay = new Map<string, Candle[]>();
  for (const c of spot15) {
    const k = dayKey(candleEnd(c));
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(c);
  }
  const futByTs = new Map(fut15.map((c) => [c.timestamp, c]));
  const sortedDays = [...byDay.keys()].sort();

  interface Day { date: string; candles: Candle[]; atr14: number; futVwap: number; prevDayClose: number }
  const days: Day[] = [];
  for (let di = 0; di < sortedDays.length; di++) {
    const date = sortedDays[di]!;
    if (date < rangeStart.toLocaleDateString("en-CA", { timeZone: TZ })) continue;
    const candles = byDay.get(date)!;
    if (candles.length < 10) continue;
    const dayStart = Date.parse(candles[0]!.timestamp);
    const hist = spot15.filter((c) => Date.parse(c.timestamp) + 15 * 60_000 <= dayStart).slice(-60);
    const atr14 = atr(hist) ?? 0;
    if (!(atr14 > 0)) continue;
    const futDay = candles.map((c) => futByTs.get(c.timestamp)).filter(Boolean) as Candle[];
    const futVwap = (() => {
      const tp = futDay.reduce((s, c) => s + ((c.high + c.low + c.close) / 3) * (c.volume || 1), 0);
      const v = futDay.reduce((s, c) => s + (c.volume || 1), 0);
      return v > 0 ? tp / v : 0;
    })();
    const prevClose = di > 0 ? byDay.get(sortedDays[di - 1]!)!.at(-1)!.close : candles[0]!.open;
    days.push({ date, candles, atr14, futVwap, prevDayClose: prevClose });
  }
  console.log(`trading days: ${days.length}`);

  const run = (name: string, fn: (d: Day, i: number) => { action: Action; gapFill: boolean } | Action, forceGapFill = false) => {
    let w = 0, l = 0, e = 0, pts = 0, signals = 0;
    const trades: string[] = [];
    const openDays = new Set<string>();
    const dailyCounts = new Map<string, number>();
    for (const d of days) {
      if (openDays.has(d.date)) continue;
      for (let i = 0; i < d.candles.length; i++) {
        const end = candleEnd(d.candles[i]!);
        if (!isMarketOpen(end, TZ) || !isWithinEntryWindow(end, TZ)) continue;
        const r = fn(d, i);
        const res = typeof r === "object" && r !== null ? r : { action: r as Action, gapFill: forceGapFill };
        if (!res.action) continue;
        if ((dailyCounts.get(d.date) ?? 0) >= DEFAULTS.maxDailySignals) break;
        dailyCounts.set(d.date, (dailyCounts.get(d.date) ?? 0) + 1);
        const entry = d.candles[i]!.close;
        const out = res.gapFill
          ? simulateOutcomePx(d.candles, i, res.action, entry, d.atr14, d.prevDayClose)
          : simulateOutcome(d.candles, i, res.action, entry, d.atr14);
        signals++;
        if (out.result === "WIN") w++; else if (out.result === "LOSS") l++; else e++;
        pts += out.pnl;
        const hhmm = end.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
        trades.push(`  ${d.date} ${hhmm} ${res.action} @${entry.toFixed(1)} -> ${out.result} ${out.pnl >= 0 ? "+" : ""}${out.pnl.toFixed(0)}`);
        openDays.add(d.date);
        break;
      }
    }
    console.log(`${name.padEnd(18)} signals=${String(signals).padStart(3)}  W=${w} L=${l} EOD=${e}  pts=${pts >= 0 ? "+" : ""}${pts.toFixed(0)}`);
    for (const t of trades.slice(-15)) console.log(t);
  };

  run("GapFade-0.4%-fill", (d, i) => ({ action: gapFade(d.candles, d.prevDayClose, i, 0.004), gapFill: true }));
  run("VWAP+late(>13:00)", (d, i) => candleEndMin(d.candles[i]!) >= 13 * 60 ? vwapReclaim(d.candles, i, d.futVwap) : null);
  run("Combo-late", (d, i) => comboLate(d.candles, d.prevDayClose, i, d.futVwap));
}
