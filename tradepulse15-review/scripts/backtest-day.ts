import { env } from "../src/config/env.js";
import { getInstruments, resolveFuturesInstrument, resolveIndexInstrument } from "../src/broker/instrumentMaster.js";
import { fetchHistoricalCandles, type KiteCredentials } from "../src/broker/kiteClient.js";
import { buildFuturesIndicators, buildHourlyIndicators, buildSpotIndicators15m } from "../src/application/snapshotBuilder.js";
import { isMarketOpen, isWithinEntryWindow } from "../src/application/marketClock.js";
import { evaluatePrecision15 } from "../src/strategy/precisionStrategy.js";
import { DEFAULTS } from "../src/config/defaults.js";
import type { Candle, MarketSnapshot } from "../src/domain/types.js";

const TZ = env.APP_TIMEZONE;
const dateArg = process.argv[2]; // e.g. 2026-11-13
const targetDate = dateArg ?? new Date(Date.now() - 86400e3).toISOString().slice(0, 10);

const creds: KiteCredentials = { apiKey: env.KITE_API_KEY ?? "", accessToken: env.KITE_ACCESS_TOKEN };

function toCandle(k: { timestamp: string; open: number; high: number; low: number; close: number; volume: number }): Candle {
  return { timestamp: k.timestamp, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume, complete: true };
}

const now = new Date();
const from15 = new Date(now.getTime() - 25 * 86400e3);
const from1h = new Date(now.getTime() - 90 * 86400e3);

for (const symbol of ["NIFTY", "SENSEX"] as const) {
  const spotEx = symbol === "NIFTY" ? "NSE" : "BSE";
  const futEx = symbol === "NIFTY" ? "NFO" : "BFO";
  const [spotMaster, futMaster] = await Promise.all([getInstruments(creds, spotEx), getInstruments(creds, futEx)]);
  const index = resolveIndexInstrument(spotMaster, symbol);
  const fut = resolveFuturesInstrument(futMaster, symbol, now);
  console.log(`\n=== ${symbol} ===`);
  console.log(`index: ${index.tradingsymbol} (${index.instrumentToken}) | futures: ${fut.tradingsymbol} exp ${fut.expiry}`);

  const [spot15, spot1h, fut15] = await Promise.all([
    fetchHistoricalCandles(creds, index.instrumentToken, "15minute", from15, now, false, TZ).then((r) => r.map(toCandle)),
    fetchHistoricalCandles(creds, index.instrumentToken, "60minute", from1h, now, false, TZ).then((r) => r.map(toCandle)),
    fetchHistoricalCandles(creds, fut.instrumentToken, "15minute", from15, now, true, TZ).then((r) => r.map(toCandle)),
  ]);

  // candidate evaluation instants: end of each 15m candle on target date
  const evalTimes = spot15
    .map((c) => new Date(Date.parse(c.timestamp) + 15 * 60_000))
    .filter((t) => t.toLocaleDateString("en-CA", { timeZone: TZ }) === targetDate && isMarketOpen(t, TZ));

  const results: { time: string; action: string; score: number; reasons: string[]; rejected: string[] }[] = [];
  for (const evalTime of evalTimes) {
    const realNow = Date.now;
    Date.now = () => evalTime.getTime(); // simulate "now" = candle close so staleness gates pass
    try {
      const i15 = buildSpotIndicators15m(spot15, evalTime);
      const i1h = buildHourlyIndicators(spot1h, evalTime);
      const iF = buildFuturesIndicators(fut15, evalTime, TZ);
      if (!i15 || !i1h || !iF) {
        results.push({ time: evalTime.toISOString(), action: "NO_DATA", score: 0, reasons: [], rejected: ["insufficient indicator history"] });
        continue;
      }
      const snapshot: MarketSnapshot = {
        symbol, spot15m: spot15, spot1h, futures15m: fut15,
        spotIndicators15m: i15, spotIndicators1h: i1h, futuresIndicators15m: iF,
        marketOpen: isMarketOpen(evalTime, TZ),
      };
      const d = evaluatePrecision15(snapshot, {
        minSignalScore: env.MIN_SIGNAL_SCORE ?? DEFAULTS.minSignalScore,
        minAdx: DEFAULTS.minAdx,
        minRelativeVolume: DEFAULTS.minRelativeVolume,
      });
      const inWindow = isWithinEntryWindow(evalTime, TZ);
      results.push({
        time: evalTime.toISOString(), action: inWindow ? d.action : `${d.action}*(outside window)`,
        score: d.score, reasons: d.reasons, rejected: d.rejectedReasons,
      });
    } finally {
      Date.now = realNow;
    }
  }

  const actionable = results.filter((r) => r.action.startsWith("BUY_"));
  const holds = results.filter((r) => r.action.startsWith("HOLD"));
  console.log(`evaluations: ${results.length} | actionable: ${actionable.length} | holds: ${holds.length}`);
  for (const r of actionable) {
    console.log(`  ${r.time}  ${r.action}  score=${r.score}`);
    for (const reason of r.reasons) console.log(`      + ${reason}`);
  }
  // summarize most common rejection reasons
  const freq = new Map<string, number>();
  for (const r of holds) for (const reason of r.rejected) freq.set(reason, (freq.get(reason) ?? 0) + 1);
  console.log("top HOLD reasons:");
  [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([r, n]) => console.log(`  ${n}x  ${r}`));
}
