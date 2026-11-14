import { env } from "../src/config/env.js";
import { getInstruments, resolveFuturesInstrument, resolveIndexInstrument } from "../src/broker/instrumentMaster.js";
import { fetchHistoricalCandles, type KiteCredentials, type KiteCandle } from "../src/broker/kiteClient.js";
import { buildFuturesIndicators, buildHourlyIndicators, buildSpotIndicators15m } from "../src/application/snapshotBuilder.js";
import { isMarketOpen, isWithinEntryWindow } from "../src/application/marketClock.js";
import { evaluatePrecision15 } from "../src/strategy/precisionStrategy.js";
import { DEFAULTS } from "../src/config/defaults.js";
import type { Candle, MarketSnapshot } from "../src/domain/types.js";

const TZ = "Asia/Kolkata";
const daysBack = Number(process.argv[2] ?? 180);
const rangeStart = new Date(Date.now() - daysBack * 86400e3);

const creds: KiteCredentials = { apiKey: env.KITE_API_KEY ?? "", accessToken: env.KITE_ACCESS_TOKEN };
const toCandle = (k: KiteCandle): Candle =>
  ({ timestamp: k.timestamp, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume, complete: true });

interface SignalEvent {
  symbol: string; date: string; time: string; action: string; score: number;
  entry: number; result: "WIN" | "LOSS" | "EOD"; exitPrice: number; pnlPoints: number;
  mfePts: number; // max favorable excursion in underlying points before exit
  rsi: number; adx: number; relVol: number; macdHist: number; supertrend: string; diSpread: number;
}

const events: SignalEvent[] = [];
let totalEvaluations = 0;
const dailyCounts = new Map<string, number>();
const holdScores: number[] = [];
const rejectionFreq = new Map<string, number>();
let maxScore = 0;
let maxScoreInfo = "";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchChunk(token: number, interval: string, from: Date, to: Date, oi: boolean): Promise<KiteCandle[]> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await fetchHistoricalCandles(creds, token, interval, from, to, oi, TZ);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status !== 429 || attempt === 5) throw error;
      await sleep(5000 * (attempt + 1));
    }
  }
  return [];
}

const CHUNK_MS = 30 * 86400e3;
async function fetchRange(token: number, interval: string, from: Date, to: Date, oi: boolean): Promise<KiteCandle[]> {
  const out: KiteCandle[] = [];
  const seen = new Set<string>();
  for (let s = from.getTime(); s < to.getTime(); s += CHUNK_MS) {
    const e = new Date(Math.min(s + CHUNK_MS, to.getTime()));
    const candles = await fetchChunk(token, interval, new Date(s), e, oi);
    for (const c of candles) {
      if (seen.has(c.timestamp)) continue;
      seen.add(c.timestamp);
      out.push(c);
    }
    await sleep(400); // pace requests to stay under Kite rate limits
  }
  return out.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function evaluateAt(symbol: "NIFTY" | "SENSEX", spot15w: Candle[], spot1hw: Candle[], fut15w: Candle[], evalTime: Date) {
  const realNow = Date.now;
  Date.now = () => evalTime.getTime();
  try {
    const i15 = buildSpotIndicators15m(spot15w, evalTime);
    const i1h = buildHourlyIndicators(spot1hw, evalTime);
    const iF = buildFuturesIndicators(fut15w, evalTime, TZ);
    if (!i15 || !i1h || !iF) return null;
    const snapshot: MarketSnapshot = {
      symbol, spot15m: spot15w, spot1h: spot1hw, futures15m: fut15w,
      spotIndicators15m: i15, spotIndicators1h: i1h, futuresIndicators15m: iF,
      marketOpen: isMarketOpen(evalTime, TZ),
    };
    return { decision: evaluatePrecision15(snapshot, { minSignalScore: env.MIN_SIGNAL_SCORE ?? DEFAULTS.minSignalScore, minAdx: DEFAULTS.minAdx, minRelativeVolume: DEFAULTS.minRelativeVolume }), i15, iF };
  } finally {
    Date.now = realNow;
  }
}

function simulateOutcome(spot15: Candle[], evalTime: Date, action: "BUY_CALL" | "BUY_PUT", entry: number, atr: number): { result: SignalEvent["result"]; exitPrice: number; pnlPoints: number; mfePts: number } {
  const dir = action === "BUY_CALL" ? 1 : -1;
  const stopDist = env.STOP_ATR_MULTIPLE * atr;
  const stop = entry - dir * stopDist;
  const target = entry + dir * env.TARGET_R_MULTIPLE * stopDist;
  const evalDay = evalTime.toLocaleDateString("en-CA", { timeZone: TZ });
  const after = spot15.filter((c) => {
    const t = new Date(Date.parse(c.timestamp) + 15 * 60_000);
    return t > evalTime && t.toLocaleDateString("en-CA", { timeZone: TZ }) === evalDay;
  });
  let mfe = 0;
  for (const c of after) {
    const fav = dir === 1 ? c.high - entry : entry - c.low;
    if (fav > mfe) mfe = fav;
    const hitStop = dir === 1 ? c.low <= stop : c.high >= stop;
    const hitTarget = dir === 1 ? c.high >= target : c.low <= target;
    if (hitStop) return { result: "LOSS", exitPrice: stop, pnlPoints: dir * (stop - entry), mfePts: mfe };
    if (hitTarget) return { result: "WIN", exitPrice: target, pnlPoints: dir * (target - entry), mfePts: mfe };
  }
  const last = after.at(-1);
  const exit = last ? last.close : entry;
  return { result: "EOD", exitPrice: exit, pnlPoints: dir * (exit - entry), mfePts: mfe };
}

// candles with interval end <= t, trimmed to last `keep` entries
function windowUpTo(candles: Candle[], intervalMin: number, t: Date, keep: number): Candle[] {
  const cutoff = t.getTime();
  let hi = candles.length;
  // binary search last index whose candle end <= cutoff
  let lo = 0;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (Date.parse(candles[mid]!.timestamp) + intervalMin * 60_000 <= cutoff) lo = mid + 1; else hi = mid;
  }
  return candles.slice(Math.max(0, lo - keep), lo);
}

for (const symbol of ["NIFTY", "SENSEX"] as const) {
  const spotEx = symbol === "NIFTY" ? "NSE" : "BSE";
  const futEx = symbol === "NIFTY" ? "NFO" : "BFO";
  const [spotMaster, futMaster] = await Promise.all([getInstruments(creds, spotEx), getInstruments(creds, futEx)]);
  const index = resolveIndexInstrument(spotMaster, symbol);
  const fut = resolveFuturesInstrument(futMaster, symbol, new Date());
  console.log(`\n=== ${symbol} === fetching...`);

  const fetchFrom = new Date(rangeStart.getTime() - 45 * 86400e3); // warmup before range
  const nowD = new Date();
  const [spot15, spot1h, fut15] = await Promise.all([
    fetchRange(index.instrumentToken, "15minute", fetchFrom, nowD, false).then((r) => r.map(toCandle)),
    fetchRange(index.instrumentToken, "60minute", new Date(rangeStart.getTime() - 60 * 86400e3), nowD, false).then((r) => r.map(toCandle)),
    fetchRange(fut.instrumentToken, "15minute", fetchFrom, nowD, true).then((r) => r.map(toCandle)),
  ]);
  console.log(`${symbol}: spot15=${spot15.length} spot1h=${spot1h.length} fut15=${fut15.length} candles`);

  const evalTimes = spot15
    .map((c) => new Date(Date.parse(c.timestamp) + 15 * 60_000))
    .filter((t) => t >= rangeStart && isMarketOpen(t, TZ) && isWithinEntryWindow(t, TZ));
  console.log(`${symbol}: ${evalTimes.length} entry-window evaluations`);

  let inPosition = false;
  let positionDay = "";
  for (const evalTime of evalTimes) {
    totalEvaluations++;
    const evalDay = evalTime.toLocaleDateString("en-CA", { timeZone: TZ });
    if (inPosition && evalDay !== positionDay) inPosition = false;
    if (inPosition) continue;
    // trimmed windows: enough history for indicators + slot-average samples
    const spot15w = windowUpTo(spot15, 15, evalTime, 300);
    const spot1hw = windowUpTo(spot1h, 60, evalTime, 300);
    const fut15w = windowUpTo(fut15, 15, evalTime, 900);
    const r = evaluateAt(symbol, spot15w, spot1hw, fut15w, evalTime);
    if (!r) continue;
    if (r.decision.score > maxScore) {
      maxScore = r.decision.score;
      maxScoreInfo = `${symbol} ${evalTime.toISOString()} action=${r.decision.action}`;
    }
    if (r.decision.action === "HOLD") {
      holdScores.push(r.decision.score);
      for (const reason of r.decision.rejectedReasons) rejectionFreq.set(reason, (rejectionFreq.get(reason) ?? 0) + 1);
      continue;
    }
    const count = dailyCounts.get(evalDay) ?? 0;
    if (count >= DEFAULTS.maxDailySignals) continue;
    const action = r.decision.action as "BUY_CALL" | "BUY_PUT";
    // outcome uses the fuller spot15 array for the remainder of the day
    const outcome = simulateOutcome(spot15, evalTime, action, r.i15.lastClose, r.i15.atr14);
    const volBase = r.iF.futuresVolumeSlotAvg ?? r.iF.futuresVolumeSma20;
    events.push({
      symbol, date: evalDay, time: evalTime.toISOString(), action,
      score: r.decision.score, entry: r.i15.lastClose, ...outcome,
      rsi: r.i15.rsi14, adx: r.i15.adx14,
      relVol: volBase > 0 ? r.iF.futuresVolume / volBase : 0,
      macdHist: r.i15.macdHistogram,
      supertrend: r.i15.supertrendDirection,
      diSpread: action === "BUY_CALL" ? r.i15.plusDi14 - r.i15.minusDi14 : r.i15.minusDi14 - r.i15.plusDi14,
    });
    dailyCounts.set(evalDay, count + 1);
    inPosition = true;
    positionDay = evalDay;
    if (outcome.result !== "EOD") inPosition = false;
  }
}

console.log(`\nRange: last ${daysBack} days | entry-window evaluations: ${totalEvaluations}`);
console.log(`Actionable signals (after daily cap + 1-open rule): ${events.length}\n`);
for (const e of events) {
  console.log(`${e.date} ${e.time.slice(11, 16)}Z ${e.symbol} ${e.action} score=${e.score} entry=${e.entry} -> ${e.result} @${e.exitPrice.toFixed(2)} (${e.pnlPoints >= 0 ? "+" : ""}${e.pnlPoints.toFixed(1)} pts) | MFE +${e.mfePts.toFixed(0)} | rsi=${e.rsi.toFixed(0)} adx=${e.adx.toFixed(0)} relVol=${e.relVol.toFixed(2)} macdH=${e.macdHist.toFixed(2)} diSpread=${e.diSpread.toFixed(1)}`);
}
const avgMfe = events.reduce((s, e) => s + e.mfePts, 0) / Math.max(1, events.length);
console.log(`Avg max favorable excursion before exit: +${avgMfe.toFixed(1)} pts`);
const wins = events.filter((e) => e.result === "WIN").length;
const losses = events.filter((e) => e.result === "LOSS").length;
const eods = events.filter((e) => e.result === "EOD").length;
const totalPts = events.reduce((s, e) => s + e.pnlPoints, 0);
const tradingDays = new Set(events.map((e) => e.date)).size;
console.log(`\nSummary: ${wins}W / ${losses}L / ${eods}EOD | total underlying points: ${totalPts >= 0 ? "+" : ""}${totalPts.toFixed(1)}`);
console.log(`Signal frequency: ${events.length} signals over ~${daysBack} calendar days`);
if (holdScores.length) {
  const sorted = [...holdScores].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  console.log(`HOLD scores (n=${holdScores.length}): p50=${pct(0.5)} p90=${pct(0.9)} p99=${pct(0.99)} max=${sorted.at(-1)}`);
  console.log(`Highest: ${maxScoreInfo} (score ${maxScore})`);
  console.log("Top rejection reasons:");
  [...rejectionFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([r, n]) => console.log(`  ${n}x  ${r}`));
}
