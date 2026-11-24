import { env } from "../src/config/env.js";
import { getInstruments, resolveFuturesInstrument, resolveIndexInstrument } from "../src/broker/instrumentMaster.js";
import { fetchHistoricalCandles, type KiteCredentials } from "../src/broker/kiteClient.js";
import { buildFuturesIndicators, buildHourlyIndicators, buildSpotIndicators15m } from "../src/application/snapshotBuilder.js";
import { completedCandles, isMarketOpen, isWithinEntryWindow, istDateKey } from "../src/application/marketClock.js";
import { evaluatePrecision15 } from "../src/strategy/precisionStrategy.js";
import { altEntryAction } from "../src/strategy/altStrategies.js";
import { DailySignalLimiter } from "../src/application/dailySignalLimiter.js";
import { DEFAULTS } from "../src/config/defaults.js";
import type { Candle, IndexSymbol, MarketSnapshot, TradingSignal } from "../src/domain/types.js";

const TZ = "Asia/Kolkata";
const dateArg = process.argv[2]; // e.g. 2026-11-13 (IST date)
const targetDate = dateArg ?? istDateKey(new Date(Date.now() - 86400e3), TZ);

const creds: KiteCredentials = { apiKey: env.KITE_API_KEY ?? "", accessToken: env.KITE_ACCESS_TOKEN };

function toCandle(k: { timestamp: string; open: number; high: number; low: number; close: number; volume: number }): Candle {
  return { timestamp: k.timestamp, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume, complete: true };
}

const now = new Date();
const from15 = new Date(now.getTime() - 30 * 86400e3);
const from1h = new Date(now.getTime() - 90 * 86400e3);

// Shared across symbols so the one-open-position / daily-cap rules match live.
const limiter = new DailySignalLimiter(env.MAX_TRADES_PER_DAY, env.MAX_OPEN_RECOMMENDATIONS);

for (const symbol of ["NIFTY", "SENSEX"] as const) {
  const spotEx = symbol === "NIFTY" ? "NSE" : "BSE";
  const futEx = symbol === "NIFTY" ? "NFO" : "BFO";
  const [spotMaster, futMaster] = await Promise.all([getInstruments(creds, spotEx), getInstruments(creds, futEx)]);
  const index = resolveIndexInstrument(spotMaster, symbol);
  const fut = resolveFuturesInstrument(futMaster, symbol, now);
  console.log(`\n=== ${symbol} ===`);
  console.log(`index: ${index.tradingsymbol} (${index.instrumentToken}) | futures: ${fut.tradingsymbol} exp ${fut.expiry}`);
  console.log(`STRATEGY_MODE=${env.STRATEGY_MODE} | replay date=${targetDate} IST`);

  const [spot15Raw, spot1hRaw, fut15Raw] = await Promise.all([
    fetchHistoricalCandles(creds, index.instrumentToken, "15minute", from15, now, false, TZ),
    fetchHistoricalCandles(creds, index.instrumentToken, "60minute", from1h, now, false, TZ),
    fetchHistoricalCandles(creds, fut.instrumentToken, "15minute", from15, now, true, TZ),
  ]);
  const spot15All = spot15Raw.map(toCandle);
  const spot1hAll = spot1hRaw.map(toCandle);
  const fut15All = fut15Raw.map(toCandle);

  // Candidate evaluation instants: end of each 15m candle on target date.
  const evalTimes = spot15All
    .map((c) => new Date(Date.parse(c.timestamp) + 15 * 60_000))
    .filter((t) => istDateKey(t, TZ) === targetDate && isMarketOpen(t, TZ));

  const results: { time: string; action: string; score: number; reasons: string[]; rejected: string[]; suppressed?: string }[] = [];
  for (const evalTime of evalTimes) {
    // Truncate every series to candles fully completed by evalTime, matching
    // what the live engine sees at that instant.
    const spot15m = completedCandles(spot15All, 15, evalTime);
    const spot1h = completedCandles(spot1hAll, 60, evalTime);
    const futures15m = completedCandles(fut15All, 15, evalTime);

    const i15 = buildSpotIndicators15m(spot15m, evalTime);
    const i1h = buildHourlyIndicators(spot1h, evalTime);
    const iF = buildFuturesIndicators(futures15m, evalTime, TZ);
    if (!i15 || !i1h || !iF) {
      results.push({ time: evalTime.toISOString(), action: "NO_DATA", score: 0, reasons: [], rejected: ["insufficient indicator history"] });
      continue;
    }
    const snapshot: MarketSnapshot = {
      symbol, spot15m, spot1h, futures15m,
      spotIndicators15m: i15, spotIndicators1h: i1h, futuresIndicators15m: iF,
      marketOpen: isMarketOpen(evalTime, TZ),
    };

    if (env.STRATEGY_MODE !== "precision15") {
      // Mirror signalEngine.evaluateSymbol alt-strategy branch.
      const byDay = new Map<string, Candle[]>();
      for (const c of spot15m) {
        const k = istDateKey(new Date(Date.parse(c.timestamp) + 15 * 60_000), TZ);
        const arr = byDay.get(k) ?? [];
        arr.push(c);
        byDay.set(k, arr);
      }
      const dayKeys = [...byDay.keys()].sort();
      const todayCandles = byDay.get(targetDate) ?? [];
      const prevDayCandles = dayKeys.length > 1 ? byDay.get(dayKeys[dayKeys.length - 2]!) ?? [] : [];
      const prevDayClose = prevDayCandles.length ? prevDayCandles.at(-1)!.close : todayCandles[0]?.open ?? 0;
      const prevDayOpen = prevDayCandles.length ? prevDayCandles[0]!.open : prevDayClose;
      const prevDayRetPct = prevDayOpen > 0 ? (prevDayClose - prevDayOpen) / prevDayOpen : 0;
      const candleTs = i15.candleTimestamp;
      const latestCandleEnd = new Date(Date.parse(candleTs) + 15 * 60_000);
      const istHM = latestCandleEnd.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
      const [ih, im] = istHM.split(":").map(Number);
      const latestCandleEndMinutes = (ih ?? 0) * 60 + (im ?? 0);
      const altAction = snapshot.marketOpen
        ? altEntryAction(env.STRATEGY_MODE as Exclude<typeof env.STRATEGY_MODE, "precision15">, todayCandles, prevDayClose, iF.vwap, latestCandleEndMinutes, prevDayRetPct, spot15m)
        : null;
      if (!altAction) {
        results.push({ time: evalTime.toISOString(), action: "HOLD", score: 0, reasons: [], rejected: ["No alternative-strategy trigger on the latest completed candle"] });
        continue;
      }
      if (!limiter.canEmit(targetDate, symbol as IndexSymbol, candleTs)) {
        results.push({ time: evalTime.toISOString(), action: altAction, score: 0, reasons: [], rejected: [], suppressed: "daily cap / duplicate candle / open recommendation exists" });
        continue;
      }
      if (!isWithinEntryWindow(evalTime, TZ)) {
        results.push({ time: evalTime.toISOString(), action: `${altAction}*(outside window)`, score: 0, reasons: [`STRATEGY_MODE=${env.STRATEGY_MODE}`], rejected: [] });
        continue;
      }
      // Emitted: consume quota and keep the position "open" for the rest of the
      // replay (live positions stay open until manually closed).
      limiter.record({ symbol, candleTimestamp: candleTs } as TradingSignal, targetDate);
      limiter.markPositionOpen(symbol as IndexSymbol);
      results.push({
        time: evalTime.toISOString(), action: altAction, score: 0,
        reasons: [`STRATEGY_MODE=${env.STRATEGY_MODE} entry`, `prevDayClose=${prevDayClose.toFixed(2)}`, `sessionVwap=${iF.vwap.toFixed(2)}`],
        rejected: [],
      });
      continue;
    }

    const d = evaluatePrecision15(snapshot, {
      minSignalScore: env.MIN_SIGNAL_SCORE ?? DEFAULTS.minSignalScore,
      minAdx: DEFAULTS.minAdx,
      minRelativeVolume: DEFAULTS.minRelativeVolume,
    }, evalTime);
    const inWindow = isWithinEntryWindow(evalTime, TZ);
    results.push({
      time: evalTime.toISOString(), action: inWindow ? d.action : `${d.action}*(outside window)`,
      score: d.score, reasons: d.reasons, rejected: d.rejectedReasons,
    });
  }

  const actionable = results.filter((r) => r.action.startsWith("BUY_"));
  const suppressed = results.filter((r) => r.suppressed);
  const holds = results.filter((r) => r.action.startsWith("HOLD"));
  console.log(`evaluations: ${results.length} | actionable: ${actionable.length} | suppressed: ${suppressed.length} | holds: ${holds.length}`);
  for (const r of actionable) {
    console.log(`  ${r.time}  ${r.action}  score=${r.score}`);
    for (const reason of r.reasons) console.log(`      + ${reason}`);
  }
  for (const r of suppressed) {
    console.log(`  ${r.time}  ${r.action}  SUPPRESSED (${r.suppressed})`);
  }
  const freq = new Map<string, number>();
  for (const r of holds) for (const reason of r.rejected) freq.set(reason, (freq.get(reason) ?? 0) + 1);
  console.log("top HOLD reasons:");
  [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([r, n]) => console.log(`  ${n}x  ${r}`));
}
