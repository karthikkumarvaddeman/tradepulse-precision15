import { env } from "../src/config/env.js";
import { getInstruments, resolveIndexInstrument } from "../src/broker/instrumentMaster.js";
import { fetchHistoricalCandles, type KiteCredentials, type KiteCandle } from "../src/broker/kiteClient.js";
import type { Candle } from "../src/domain/types.js";

const TZ = "Asia/Kolkata";
const creds: KiteCredentials = { apiKey: env.KITE_API_KEY ?? "", accessToken: env.KITE_ACCESS_TOKEN };
const toCandle = (k: KiteCandle): Candle => ({ timestamp: k.timestamp, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume, complete: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dayKey = (t: Date) => t.toLocaleDateString("en-CA", { timeZone: TZ });
const end15 = (c: Candle) => new Date(Date.parse(c.timestamp) + 15 * 60_000);

async function fetchChunk(token: number, from: Date, to: Date): Promise<KiteCandle[]> {
  for (let a = 0; a < 6; a++) {
    try { return await fetchHistoricalCandles(creds, token, "15minute", from, to, false, TZ); }
    catch (e) { if ((e as { status?: number }).status !== 429 || a === 5) throw e; await sleep(5000 * (a + 1)); }
  }
  return [];
}
async function fetchRange(token: number, from: Date, to: Date): Promise<KiteCandle[]> {
  const out: KiteCandle[] = []; const seen = new Set<string>();
  for (let s = from.getTime(); s < to.getTime(); s += 30 * 86400e3) {
    for (const c of await fetchChunk(token, new Date(s), new Date(Math.min(s + 30 * 86400e3, to.getTime())))) {
      if (!seen.has(c.timestamp)) { seen.add(c.timestamp); out.push(c); }
    }
    await sleep(400);
  }
  return out.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).map(toCandle);
}

const master = await getInstruments(creds, "NSE");
const idx = resolveIndexInstrument(master, "NIFTY");
const candles = await fetchRange(idx.instrumentToken, new Date(Date.now() - 190 * 86400e3), new Date());
console.log(`NIFTY 15m candles: ${candles.length}`);

// group by day
const byDay = new Map<string, Candle[]>();
for (const c of candles) { const k = dayKey(end15(c)); (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(c); }
const days = [...byDay.entries()].filter(([, v]) => v.length >= 15).sort();
console.log(`trading days: ${days.length}\n`);

// 1) 15m return autocorrelation: does candle direction predict next candle?
let same = 0, total = 0, upSum = 0, dnSum = 0;
for (const [, cs] of days) for (let i = 1; i < cs.length; i++) {
  const r1 = cs[i]!.close - cs[i - 1]!.close, r2 = i + 1 < cs.length ? cs[i + 1]!.close - cs[i]!.close : 0;
  if (r1 !== 0 && r2 !== 0) { total++; if ((r1 > 0) === (r2 > 0)) same++; }
}
console.log(`1) 15m direction persistence: ${(100 * same / total).toFixed(1)}% of candles continue prior direction (n=${total}) — 50% = random walk`);

// 2) VWAP cross follow-through: cross above session VWAP -> next 4 candles direction
function sessionVwapUpTo(cs: Candle[], i: number): number {
  let pv = 0, vv = 0;
  for (let j = 0; j <= i; j++) { const tp = (cs[j]!.high + cs[j]!.low + cs[j]!.close) / 3; pv += tp; vv += 1; }
  return vv ? pv / vv : 0; // spot has no volume; use mean typical price as proxy
}
let crossUpWin = 0, crossUpN = 0, crossDnWin = 0, crossDnN = 0;
for (const [, cs] of days) {
  for (let i = 2; i < cs.length - 4; i++) {
    const vw = sessionVwapUpTo(cs, i), vwPrev = sessionVwapUpTo(cs, i - 1);
    const c = cs[i]!.close, p = cs[i - 1]!.close;
    const fwd = cs[i + 4]!.close - c;
    if (p <= vwPrev && c > vw) { crossUpN++; if (fwd > 0) crossUpWin++; }
    if (p >= vwPrev && c < vw) { crossDnN++; if (fwd < 0) crossDnWin++; }
  }
}
console.log(`2) VWAP-cross follow-through (next 4 candles = 1hr):`);
console.log(`   cross UP -> up next hour: ${crossUpN ? (100 * crossUpWin / crossUpN).toFixed(1) : "-"}% (n=${crossUpN})`);
console.log(`   cross DOWN -> down next hour: ${crossDnN ? (100 * crossDnWin / crossDnN).toFixed(1) : "-"}% (n=${crossDnN})`);

// 3) Gap behavior: overnight gap vs intraday fill
let gapUp = 0, gapUpFill = 0, gapDn = 0, gapDnFill = 0, bigGap = 0, bigGapFade = 0;
for (let di = 1; di < days.length; di++) {
  const prev = days[di - 1]![1].at(-1)!.close, cur = days[di]![1];
  const gap = (cur[0]!.open - prev) / prev;
  const dayHi = Math.max(...cur.map((c) => c.high)), dayLo = Math.min(...cur.map((c) => c.low));
  if (gap > 0.002) { gapUp++; if (dayLo <= prev) gapUpFill++; }
  if (gap < -0.002) { gapDn++; if (dayHi >= prev) gapDnFill++; }
  if (Math.abs(gap) > 0.006) { bigGap++; const faded = gap > 0 ? cur.at(-1)!.close < cur[0]!.open : cur.at(-1)!.close > cur[0]!.open; if (faded) bigGapFade++; }
}
console.log(`3) Gaps (>0.2%): up-gaps filled back to prev close ${gapUp ? (100 * gapUpFill / gapUp).toFixed(0) : "-"}% (n=${gapUp}), down-gaps filled ${gapDn ? (100 * gapDnFill / gapDn).toFixed(0) : "-"}% (n=${gapDn})`);
console.log(`   big gaps (>0.6%): faded by close ${bigGap ? (100 * bigGapFade / bigGap).toFixed(0) : "-"}% (n=${bigGap})`);

// 4) Daily trend persistence: up day -> next day up?
let upThenUp = 0, upN = 0, dnThenDn = 0, dnN = 0;
for (let di = 1; di < days.length; di++) {
  const d1 = days[di - 1]![1], d2 = days[di]![1];
  const r1 = d1.at(-1)!.close - d1[0]!.open, r2 = d2.at(-1)!.close - d2[0]!.open;
  if (r1 > 0) { upN++; if (r2 > 0) upThenUp++; }
  if (r1 < 0) { dnN++; if (r2 < 0) dnThenDn++; }
}
console.log(`4) Day-to-day: after UP day, next day up ${upN ? (100 * upThenUp / upN).toFixed(0) : "-"}% (n=${upN}) | after DOWN day, next down ${dnN ? (100 * dnThenDn / dnN).toFixed(0) : "-"}% (n=${dnN})`);

// 5) Volatility: avg 15m range vs close
const ranges = days.flatMap(([, cs]) => cs.map((c) => (c.high - c.low) / c.close * 100));
const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
console.log(`5) Avg 15m candle range: ${avgRange.toFixed(3)}% of price (~${(avgRange / 100 * 25000).toFixed(0)} NIFTY pts)`);
