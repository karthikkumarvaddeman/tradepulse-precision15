import { DEFAULTS } from "../config/defaults.js";
import type { IndexSymbol, MarketSnapshot, SignalDecision } from "../domain/types.js";

export interface StrategyLimits {
  minSignalScore: number;
  minAdx: number;
  minRelativeVolume: number;
}

type Gate = readonly [passed: boolean, weight: number, reason: string];

export function evaluatePrecision15(
  snapshot: MarketSnapshot,
  limits: StrategyLimits = {
    minSignalScore: DEFAULTS.minSignalScore,
    minAdx: DEFAULTS.minAdx,
    minRelativeVolume: DEFAULTS.minRelativeVolume,
  },
): SignalDecision {
  const m = snapshot.spotIndicators15m;
  const h = snapshot.spotIndicators1h;
  const f = snapshot.futuresIndicators15m;
  const reasons: string[] = [];
  const rejected: string[] = [];

  if (!snapshot.marketOpen) rejected.push("Market is closed");
  if (!snapshot.spot15m.length || snapshot.spot15m.some(c => !c.complete)) rejected.push("15-minute candles are incomplete");
  if (!snapshot.spot1h.length || snapshot.spot1h.some(c => !c.complete)) rejected.push("1-hour candles are incomplete");
  if (Date.now() - Date.parse(m.dataAsOf) > 120_000) rejected.push("15-minute indicator snapshot is stale");
  if (Date.now() - Date.parse(f.dataAsOf) > 120_000) rejected.push("Futures VWAP/volume data is stale");

  const hourlyBull = h.ema20 > h.ema50 && h.lastClose > h.ema200;
  const hourlyBear = h.ema20 < h.ema50 && h.lastClose < h.ema200;
  const fifteenBull = m.ema20 > m.ema50 && m.lastClose > m.ema200;
  const fifteenBear = m.ema20 < m.ema50 && m.lastClose < m.ema200;
  const callRsi = m.rsi14 >= 55 && m.rsi14 <= 68;
  const putRsi = m.rsi14 >= 32 && m.rsi14 <= 45;
  const volumeBaseline = f.futuresVolumeSlotAvg ?? f.futuresVolumeSma20;
  const relativeVol = volumeBaseline > 0 ? f.futuresVolume / volumeBaseline : 0;

  const callGates: Gate[] = [
    [hourlyBull, 15, "1-hour bullish trend not confirmed"],
    [fifteenBull, 15, "15-minute bullish EMA structure not confirmed"],
    [m.lastClose > f.vwap, 15, "Price is not above futures session VWAP"],
    [m.supertrendDirection === "BULLISH", 10, "Supertrend is not bullish"],
    [m.adx14 >= limits.minAdx && m.plusDi14 > m.minusDi14, 10, "ADX/+DI bullish confirmation failed"],
    [m.macdHistogram > 0 && m.macdHistogram > m.previousMacdHistogram, 10, "MACD histogram is not positive and rising"],
    [callRsi, 5, "RSI is outside the call-entry range (55–68)"],
    [relativeVol >= limits.minRelativeVolume, 10, "Futures relative volume is below threshold"],
    [m.lastClose > m.previousCandleHigh, 10, "No completed-candle bullish price-action trigger"],
  ];
  const putGates: Gate[] = [
    [hourlyBear, 15, "1-hour bearish trend not confirmed"],
    [fifteenBear, 15, "15-minute bearish EMA structure not confirmed"],
    [m.lastClose < f.vwap, 15, "Price is not below futures session VWAP"],
    [m.supertrendDirection === "BEARISH", 10, "Supertrend is not bearish"],
    [m.adx14 >= limits.minAdx && m.minusDi14 > m.plusDi14, 10, "ADX/-DI bearish confirmation failed"],
    [m.macdHistogram < 0 && m.macdHistogram < m.previousMacdHistogram, 10, "MACD histogram is not negative and falling"],
    [putRsi, 5, "RSI is outside the put-entry range (32–45)"],
    [relativeVol >= limits.minRelativeVolume, 10, "Futures relative volume is below threshold"],
    [m.lastClose < m.previousCandleLow, 10, "No completed-candle bearish price-action trigger"],
  ];

  const scoreOf = (gates: Gate[]) => gates.reduce((total, [ok, weight]) => total + (ok ? weight : 0), 0);
  const scoreCall = scoreOf(callGates);
  const scorePut = scoreOf(putGates);
  const allGlobalRejected = rejected.length > 0;

  if (allGlobalRejected) return { action: "HOLD", regime: "UNCLEAR", score: 0, reasons, rejectedReasons: rejected };

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
