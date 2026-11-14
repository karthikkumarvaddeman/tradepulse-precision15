import { DEFAULTS } from "../config/defaults.js";
import type { IndexSymbol, MarketSnapshot, SignalDecision } from "../domain/types.js";
import { isChronologicalAndComplete } from "../indicators/indicators.js";

export interface StrategyLimits {
  minSignalScore: number;
  minAdx: number;
  minRelativeVolume: number;
  max15mDataAgeMs?: number;
  max1hDataAgeMs?: number;
  rsiCallRange?: readonly [number, number];
  rsiPutRange?: readonly [number, number];
  requireMacdSlope?: boolean;
  requirePriceAction?: boolean;
  requireVwap?: boolean;
}

type Gate = readonly [passed: boolean, weight: number, reason: string];

function freshTimestamp(value: string, now: Date, maxAgeMs: number): boolean {
  const time = Date.parse(value);
  const age = now.getTime() - time;
  return Number.isFinite(time) && age >= 0 && age <= maxAgeMs;
}

function validIndicatorValues(values: number[]): boolean {
  return values.every(Number.isFinite);
}

/**
 * Pure rule evaluation. `now` is injectable so candle freshness and strategy
 * fixtures are deterministic in tests and replay/backtest runs.
 */
export function evaluatePrecision15(
  snapshot: MarketSnapshot,
  limits: StrategyLimits = {
    minSignalScore: DEFAULTS.minSignalScore,
    minAdx: DEFAULTS.minAdx,
    minRelativeVolume: DEFAULTS.minRelativeVolume,
  },
  now: Date = new Date(),
): SignalDecision {
  const m = snapshot.spotIndicators15m;
  const h = snapshot.spotIndicators1h;
  const f = snapshot.futuresIndicators15m;
  const reasons: string[] = [];
  const rejected: string[] = [];

  // A completed 15-minute bar remains the latest valid bar until the next
  // interval closes. Permit one full interval plus a 2-minute feed grace.
  const max15mAge = limits.max15mDataAgeMs ?? 17 * 60_000;
  const max1hAge = limits.max1hDataAgeMs ?? 75 * 60_000;

  if (!snapshot.marketOpen) rejected.push("Market is closed");
  if (!isChronologicalAndComplete(snapshot.spot15m)) rejected.push("15-minute candles are incomplete, invalid, or out of order");
  if (!isChronologicalAndComplete(snapshot.spot1h)) rejected.push("1-hour candles are incomplete, invalid, or out of order");
  if (!isChronologicalAndComplete(snapshot.futures15m)) rejected.push("Futures candles are incomplete, invalid, or out of order");

  if (!freshTimestamp(m.dataAsOf, now, max15mAge)) rejected.push("15-minute indicator snapshot is stale or from the future");
  if (!freshTimestamp(f.dataAsOf, now, max15mAge)) rejected.push("Futures VWAP/volume data is stale or from the future");
  if (!freshTimestamp(h.dataAsOf, now, max1hAge)) rejected.push("1-hour trend snapshot is stale or from the future");

  const lastSpot15 = snapshot.spot15m[snapshot.spot15m.length - 1];
  const lastSpot1h = snapshot.spot1h[snapshot.spot1h.length - 1];
  if (lastSpot15 && snapshot.futuresIndicators15m.candleTimestamp !== lastSpot15.timestamp) {
    rejected.push("Futures VWAP/volume candle does not match the latest completed spot entry candle");
  }
  if (!lastSpot15 || lastSpot15.timestamp !== m.candleTimestamp) rejected.push("15-minute indicator timestamp does not match the latest completed spot candle");
  else if (Math.abs(lastSpot15.close - m.lastClose) > 1e-8) rejected.push("15-minute indicator close does not match the latest completed spot candle");
  if (!lastSpot1h || lastSpot1h.timestamp !== h.candleTimestamp) rejected.push("1-hour indicator timestamp does not match the latest completed trend candle");
  else if (Math.abs(lastSpot1h.close - h.lastClose) > 1e-8) rejected.push("1-hour indicator close does not match the latest completed trend candle");

  const required = [
    m.ema20, m.ema50, m.ema200, m.rsi14, m.adx14, m.plusDi14, m.minusDi14,
    m.macd, m.macdSignal, m.macdHistogram, m.previousMacdHistogram, m.atr14,
    m.previousCandleHigh, m.previousCandleLow, m.lastClose,
    h.ema20, h.ema50, h.ema200, h.lastClose,
    f.vwap, f.futuresVolume, f.futuresVolumeSma20,
  ];
  if (!validIndicatorValues(required)) rejected.push("One or more indicator values are missing or non-finite");
  if (m.rsi14 < 0 || m.rsi14 > 100 || m.adx14 < 0 || m.adx14 > 100 || m.atr14 <= 0) {
    rejected.push("Indicator values are outside valid ranges");
  }
  if (f.futuresVolume <= 0 || f.futuresVolumeSma20 <= 0 || f.vwap <= 0) {
    rejected.push("Matching futures VWAP/volume is missing or invalid");
  }

  const hourlyBull = h.ema20 > h.ema50 && h.lastClose > h.ema200;
  const hourlyBear = h.ema20 < h.ema50 && h.lastClose < h.ema200;
  const fifteenBull = m.ema20 > m.ema50 && m.lastClose > m.ema200;
  const fifteenBear = m.ema20 < m.ema50 && m.lastClose < m.ema200;
  const callRsiRange = limits.rsiCallRange ?? [55, 68];
  const putRsiRange = limits.rsiPutRange ?? [32, 45];
  const callRsi = m.rsi14 >= callRsiRange[0] && m.rsi14 <= callRsiRange[1];
  const putRsi = m.rsi14 >= putRsiRange[0] && m.rsi14 <= putRsiRange[1];
  const macdSlopeOk = limits.requireMacdSlope === false
    ? m.macdHistogram > 0
    : m.macdHistogram > 0 && m.macdHistogram > m.previousMacdHistogram;
  const macdSlopeOkPut = limits.requireMacdSlope === false
    ? m.macdHistogram < 0
    : m.macdHistogram < 0 && m.macdHistogram < m.previousMacdHistogram;
  const priceActionCall = limits.requirePriceAction === false ? true : m.lastClose > m.previousCandleHigh;
  const priceActionPut = limits.requirePriceAction === false ? true : m.lastClose < m.previousCandleLow;
  const vwapCall = limits.requireVwap === false ? true : m.lastClose > f.vwap;
  const vwapPut = limits.requireVwap === false ? true : m.lastClose < f.vwap;
  const volumeBaseline = f.futuresVolumeSlotAvg ?? f.futuresVolumeSma20;
  const relativeVol = volumeBaseline > 0 ? f.futuresVolume / volumeBaseline : 0;

  const callGates: Gate[] = [
    [hourlyBull, 15, "1-hour bullish trend not confirmed"],
    [fifteenBull, 15, "15-minute bullish EMA structure not confirmed"],
    [vwapCall, 15, "Price is not above futures session VWAP"],
    [m.supertrendDirection === "BULLISH", 10, "Supertrend is not bullish"],
    [m.adx14 >= limits.minAdx && m.plusDi14 > m.minusDi14, 10, "ADX/+DI bullish confirmation failed"],
    [macdSlopeOk, 10, "MACD histogram is not positive and rising"],
    [callRsi, 5, `RSI is outside the call-entry range (${callRsiRange[0]}–${callRsiRange[1]})`],
    [relativeVol >= limits.minRelativeVolume, 10, "Futures relative volume is below threshold"],
    [priceActionCall, 10, "No completed-candle bullish price-action trigger"],
  ];
  const putGates: Gate[] = [
    [hourlyBear, 15, "1-hour bearish trend not confirmed"],
    [fifteenBear, 15, "15-minute bearish EMA structure not confirmed"],
    [vwapPut, 15, "Price is not below futures session VWAP"],
    [m.supertrendDirection === "BEARISH", 10, "Supertrend is not bearish"],
    [m.adx14 >= limits.minAdx && m.minusDi14 > m.plusDi14, 10, "ADX/-DI bearish confirmation failed"],
    [macdSlopeOkPut, 10, "MACD histogram is not negative and falling"],
    [putRsi, 5, `RSI is outside the put-entry range (${putRsiRange[0]}–${putRsiRange[1]})`],
    [relativeVol >= limits.minRelativeVolume, 10, "Futures relative volume is below threshold"],
    [priceActionPut, 10, "No completed-candle bearish price-action trigger"],
  ];

  if (rejected.length) {
    return { action: "HOLD", regime: hourlyBull ? "BULL_TREND" : hourlyBear ? "BEAR_TREND" : "UNCLEAR", score: 0, reasons, rejectedReasons: [...new Set(rejected)] };
  }

  const scoreOf = (gates: Gate[]) => gates.reduce((total, [ok, weight]) => total + (ok ? weight : 0), 0);
  const scoreCall = scoreOf(callGates);
  const scorePut = scoreOf(putGates);

  // Every item above is a hard gate. The score is confluence, not probability.
  if (scoreCall >= limits.minSignalScore && callGates.every(([ok]) => ok)) {
    reasons.push("1-hour and 15-minute bullish trend aligned", "Price above futures VWAP", "Bullish Supertrend and ADX/DI", "MACD histogram positive and rising", "RSI in preferred call range", `Futures relative volume ${relativeVol.toFixed(2)}x`, "Completed bullish price-action trigger");
    return { action: "BUY_CALL", regime: "BULL_TREND", score: scoreCall, reasons, rejectedReasons: [] };
  }
  if (scorePut >= limits.minSignalScore && putGates.every(([ok]) => ok)) {
    reasons.push("1-hour and 15-minute bearish trend aligned", "Price below futures VWAP", "Bearish Supertrend and ADX/DI", "MACD histogram negative and falling", "RSI in preferred put range", `Futures relative volume ${relativeVol.toFixed(2)}x`, "Completed bearish price-action trigger");
    return { action: "BUY_PUT", regime: "BEAR_TREND", score: scorePut, reasons, rejectedReasons: [] };
  }

  const chosen = scoreCall >= scorePut ? callGates : putGates;
  rejected.push(...chosen.filter(([ok]) => !ok).map(([, , reason]) => reason));
  return { action: "HOLD", regime: hourlyBull ? "BULL_TREND" : hourlyBear ? "BEAR_TREND" : "UNCLEAR", score: Math.max(scoreCall, scorePut), reasons, rejectedReasons: [...new Set(rejected)] };
}

export function getExchangeForIndex(symbol: IndexSymbol): "NFO" | "BFO" {
  return symbol === "NIFTY" ? "NFO" : "BFO";
}
