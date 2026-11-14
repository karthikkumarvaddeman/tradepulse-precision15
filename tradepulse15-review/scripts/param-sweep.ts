import { env } from "../src/config/env.js";
import { getInstruments, resolveFuturesInstrument, resolveIndexInstrument } from "../src/broker/instrumentMaster.js";
import { fetchHistoricalCandles, type KiteCredentials, type KiteCandle } from "../src/broker/kiteClient.js";
import { buildFuturesIndicators, buildHourlyIndicators, buildSpotIndicators15m } from "../src/application/snapshotBuilder.js";
import { isMarketOpen, isWithinEntryWindow } from "../src/application/marketClock.js";
import { evaluatePrecision15, type StrategyLimits } from "../src/strategy/precisionStrategy.js";
import { DEFAULTS } from "../src/config/defaults.js";
import type { Candle, MarketSnapshot } from "../src/domain/types.js";

const TZ = env.APP_TIMEZONE;
const daysBack = Number(process.argv[2] ?? 180);
const rangeStart = new Date(Date.now() - daysBack * 86400e3);
const creds: KiteCredentials = { apiKey: env.KITE_API_KEY ?? "", accessToken: env.KITE_ACCESS_TOKEN };
const toCandle = (k: KiteCandle): Candle => ({ timestamp: k.timestamp, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume, complete: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
function windowUpTo(candles: Candle[], intervalMin: number, t: Date, keep: number): Candle[] {
  const cutoff = t.getTime(); let lo = 0, hi = candles.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (Date.parse(candles[mid]!.timestamp) + intervalMin * 60_000 <= cutoff) lo = mid + 1; else hi = mid; }
  return candles.slice(Math.max(0, lo - keep), lo);
}
function simulateOutcome(spot15: Candle[], evalTime: Date, action: "BUY_CALL" | "BUY_PUT", entry: number, atr: number) {
  const dir = action === "BUY_CALL" ? 1 : -1;
  const stopDist = env.STOP_ATR_MULTIPLE * atr;
  const stop = entry - dir * stopDist, target = entry + dir * env.TARGET_R_MULTIPLE * stopDist;
  const evalDay = evalTime.toLocaleDateString("en-CA", { timeZone: TZ });
  for (const c of spot15) {
    const t = new Date(Date.parse(c.timestamp) + 15 * 60_000);
    if (t <= evalTime || t.toLocaleDateString("en-CA", { timeZone: TZ }) !== evalDay) continue;
    const hitStop = dir === 1 ? c.low <= stop : c.high >= stop;
    const hitTarget = dir === 1 ? c.high >= target : c.low <= target;
    if (hitStop) return { result: "LOSS" as const, pnl: dir * (stop - entry) };
    if (hitTarget) return { result: "WIN" as const, pnl: dir * (target - entry) };
  }
  const last = spot15.filter((c) => new Date(Date.parse(c.timestamp) + 15 * 60_000).toLocaleDateString("en-CA", { timeZone: TZ }) === evalDay).at(-1);
  const exit = last ? last.close : entry;
  return { result: "EOD" as const, pnl: dir * (exit - entry) };
}

interface EvalPoint { evalTime: Date; evalDay: string; snapshot: MarketSnapshot; lastClose: number; atr: number; spot15: Candle[] }

const CONFIGS: [string, Partial<StrategyLimits>][] = [
  ["baseline ADX22 / RV1.2", { minAdx: 22, minRelativeVolume: 1.2 }],
  ["candidate ADX25 / RV1.5", { minAdx: 25, minRelativeVolume: 1.5 }],
];

const allPoints: EvalPoint[] = [];
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
  const evalTimes = spot15.map((c) => new Date(Date.parse(c.timestamp) + 15 * 60_000))
    .filter((t) => t >= rangeStart && isMarketOpen(t, TZ) && isWithinEntryWindow(t, TZ));
  let built = 0, skipped = 0;
  for (const evalTime of evalTimes) {
    const spot15w = windowUpTo(spot15, 15, evalTime, 300);
    const spot1hw = windowUpTo(spot1h, 60, evalTime, 300);
    const fut15w = windowUpTo(fut15, 15, evalTime, 900);
    const i15 = buildSpotIndicators15m(spot15w, evalTime);
    const i1h = buildHourlyIndicators(spot1hw, evalTime);
    const iF = buildFuturesIndicators(fut15w, evalTime, TZ);
    if (!i15 || !i1h || !iF) { skipped++; continue; }
    const lastSpot = spot15w[spot15w.length - 1]!;
    const last1h = spot1hw[spot1hw.length - 1]!;
    const lastFut = fut15w[fut15w.length - 1]!;
    const snapshot: MarketSnapshot = {
      symbol, spot15m: [lastSpot], spot1h: [last1h], futures15m: [lastFut],
      spotIndicators15m: i15, spotIndicators1h: i1h, futuresIndicators15m: iF,
      marketOpen: true,
    };
    allPoints.push({ evalTime, evalDay: evalTime.toLocaleDateString("en-CA", { timeZone: TZ }), snapshot, lastClose: i15.lastClose, atr: i15.atr14, spot15 });
    built++;
  }
  console.log(`${symbol}: ${built} snapshots built, ${skipped} skipped (insufficient history)`);
}

console.log(`\nTotal valid evaluation snapshots: ${allPoints.length} | comparison variants: ${CONFIGS.length}`);
console.log("Current-contract futures data is not continuous across the requested range; compare only this shared aligned sample.\n");
allPoints.sort((a, b) => a.evalTime.getTime() - b.evalTime.getTime());
for (const [name, overrides] of CONFIGS) {
  const limits: StrategyLimits = { minSignalScore: env.MIN_SIGNAL_SCORE ?? DEFAULTS.minSignalScore, minAdx: DEFAULTS.minAdx, minRelativeVolume: DEFAULTS.minRelativeVolume, ...overrides };
  const dailyCounts = new Map<string, number>();
  const stats = {
    NIFTY: { signals: 0, wins: 0, losses: 0, eod: 0, points: 0 },
    SENSEX: { signals: 0, wins: 0, losses: 0, eod: 0, points: 0 },
  };
  let inPosition = false, positionDay = "";
  for (const p of allPoints) {
    if (inPosition && p.evalDay !== positionDay) inPosition = false;
    if (inPosition) continue;
    const d = evaluatePrecision15(p.snapshot, limits, p.evalTime);
    if (d.action === "HOLD") continue;
    const count = dailyCounts.get(p.evalDay) ?? 0;
    if (count >= env.MAX_TRADES_PER_DAY) continue;
    const action = d.action as "BUY_CALL" | "BUY_PUT";
    const outcome = simulateOutcome(p.spot15, p.evalTime, action, p.lastClose, p.atr);
    const symbolStats = stats[p.snapshot.symbol];
    symbolStats.signals++;
    symbolStats.points += outcome.pnl;
    if (outcome.result === "WIN") symbolStats.wins++; else if (outcome.result === "LOSS") symbolStats.losses++; else symbolStats.eod++;
    dailyCounts.set(p.evalDay, count + 1);
    inPosition = true; positionDay = p.evalDay;
    if (outcome.result !== "EOD") inPosition = false;
  }
  const format = (symbol: "NIFTY" | "SENSEX") => {
    const s = stats[symbol];
    return `${symbol}: n=${s.signals} W=${s.wins} L=${s.losses} EOD=${s.eod} points=${s.points >= 0 ? "+" : ""}${s.points.toFixed(1)}`;
  };
  console.log(`${name}\n  ${format("NIFTY")}\n  ${format("SENSEX")}`);
}
