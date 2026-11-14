import type { Candle, IndicatorSnapshot, MarketSnapshot } from "../domain/types.js";
import { adx, atr, averageVolume, ema, isChronologicalAndComplete, macd, rsi, supertrend, vwap } from "../indicators/indicators.js";
import { completedCandles } from "./marketClock.js";

export const MIN_CANDLES_15M = 220;
export const MIN_CANDLES_1H = 220;

function completedOnly(candles: Candle[], intervalMinutes: number, now: Date): Candle[] {
  return completedCandles(candles.filter((c) => c.complete), intervalMinutes, now);
}

function dataAsOf(last: Candle, intervalMinutes: number): string {
  return new Date(Date.parse(last.timestamp) + intervalMinutes * 60_000).toISOString();
}

export function buildSpotIndicators15m(candles: Candle[], now: Date): IndicatorSnapshot | null {
  const done = completedOnly(candles, 15, now);
  if (!isChronologicalAndComplete(done) || done.length < MIN_CANDLES_15M) return null;
  const last = done[done.length - 1]!;
  const previous = done[done.length - 2]!;
  const closes = done.map((c) => c.close);
  const macdResult = macd(closes);
  const adxResult = adx(done);
  const atrValue = atr(done, 14);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsiValue = rsi(closes, 14);
  const stDirection = supertrend(done, 10, 3);
  if (ema20 == null || ema50 == null || ema200 == null || rsiValue == null || !adxResult || !macdResult || atrValue == null || !stDirection) return null;
  return {
    ema20, ema50, ema200,
    rsi14: rsiValue,
    adx14: adxResult.adx, plusDi14: adxResult.plusDi, minusDi14: adxResult.minusDi,
    macd: macdResult.macd, macdSignal: macdResult.signal,
    macdHistogram: macdResult.histogram, previousMacdHistogram: macdResult.previousHistogram,
    supertrendDirection: stDirection,
    atr14: atrValue,
    vwap: vwap(done) ?? 0,
    futuresVolume: 0, futuresVolumeSma20: 0,
    previousCandleHigh: previous.high, previousCandleLow: previous.low,
    lastClose: last.close,
    candleTimestamp: last.timestamp,
    dataAsOf: dataAsOf(last, 15),
  };
}

export function buildHourlyIndicators(candles: Candle[], now: Date): MarketSnapshot["spotIndicators1h"] | null {
  const done = completedOnly(candles, 60, now);
  if (!isChronologicalAndComplete(done) || done.length < MIN_CANDLES_1H) return null;
  const last = done[done.length - 1]!;
  const closes = done.map((c) => c.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  if (ema20 == null || ema50 == null || ema200 == null) return null;
  return {
    ema20, ema50, ema200,
    lastClose: last.close,
    candleTimestamp: last.timestamp,
    dataAsOf: dataAsOf(last, 60),
  };
}

function sameSessionDate(a: string, b: string, timeZone: string): boolean {
  return new Date(a).toLocaleDateString("en-CA", { timeZone }) === new Date(b).toLocaleDateString("en-CA", { timeZone });
}

function slotKey(timestamp: string, timeZone: string): string {
  return new Date(timestamp).toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
}

const MIN_SLOT_SAMPLES = 8;

/** Average volume for the same time-of-day slot across prior sessions — fixes U-shaped intraday volume bias. */
function slotAverageVolume(candles: Candle[], last: Candle, timeZone: string): number | null {
  const key = slotKey(last.timestamp, timeZone);
  const volumes = candles
    .filter((c) => slotKey(c.timestamp, timeZone) === key && c.volume != null)
    .map((c) => c.volume!);
  if (volumes.length < MIN_SLOT_SAMPLES) return null;
  return volumes.reduce((a, b) => a + b, 0) / volumes.length;
}

export function buildFuturesIndicators(candles: Candle[], now: Date, timeZone: string): MarketSnapshot["futuresIndicators15m"] | null {
  const done = completedOnly(candles, 15, now);
  if (!isChronologicalAndComplete(done) || done.length < 25) return null;
  const last = done[done.length - 1]!;
  const sessionCandles = done.filter((c) => sameSessionDate(c.timestamp, last.timestamp, timeZone));
  const avgVolume = averageVolume(done, 20);
  const sessionVwap = vwap(sessionCandles);
  if (sessionVwap == null || avgVolume == null || avgVolume <= 0 || !last.volume) return null;
  return {
    vwap: sessionVwap,
    futuresVolume: last.volume,
    futuresVolumeSma20: avgVolume,
    futuresVolumeSlotAvg: slotAverageVolume(done, last, timeZone) ?? undefined,
    dataAsOf: dataAsOf(last, 15),
  };
}
