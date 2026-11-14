import { describe, expect, it } from "vitest";
import { calculateAffordableLots, hasHitDailyLossLimit } from "../src/risk/riskManager.js";
import { evaluatePrecision15, getExchangeForIndex } from "../src/strategy/precisionStrategy.js";
import type { Candle, IndicatorSnapshot, MarketSnapshot } from "../src/domain/types.js";

function candle(offsetMinutes: number, complete = true): Candle {
  return {
    timestamp: new Date(Date.now() - offsetMinutes * 60_000).toISOString(),
    open: 100, high: 101, low: 99, close: 100.5, volume: 1000, complete,
  };
}

function bullishSnapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  const indicators15m: IndicatorSnapshot = {
    ema20: 105, ema50: 100, ema200: 90,
    rsi14: 60, adx14: 30, plusDi14: 35, minusDi14: 15,
    macd: 1, macdSignal: 0.5, macdHistogram: 0.5, previousMacdHistogram: 0.2,
    supertrendDirection: "BULLISH", atr14: 2, vwap: 100,
    futuresVolume: 1200, futuresVolumeSma20: 1000,
    previousCandleHigh: 109, previousCandleLow: 95,
    lastClose: 110, candleTimestamp: candle(15).timestamp,
    dataAsOf: new Date().toISOString(),
  };
  return {
    symbol: "NIFTY",
    spot15m: [candle(30), candle(15)],
    spot1h: [candle(120), candle(60)],
    futures15m: [candle(15)],
    spotIndicators15m: indicators15m,
    spotIndicators1h: { ema20: 102, ema50: 98, ema200: 90, lastClose: 110, candleTimestamp: indicators15m.candleTimestamp, dataAsOf: new Date().toISOString() },
    futuresIndicators15m: { vwap: 105, futuresVolume: 1200, futuresVolumeSma20: 1000, dataAsOf: new Date().toISOString() },
    marketOpen: true,
    ...overrides,
  };
}

describe("Precision 15 foundations", () => {
  it("maps NIFTY and SENSEX to their derivatives exchanges", () => {
    expect(getExchangeForIndex("NIFTY")).toBe("NFO");
    expect(getExchangeForIndex("SENSEX")).toBe("BFO");
  });

  it("rejects a lot that exceeds the 0.5% risk allowance", () => {
    const result = calculateAffordableLots({ capitalInr: 80_000, premiumEntry: 120, premiumStop: 100, lotSize: 25, estimatedCostsPerLot: 30, slippageBufferPerLot: 20 });
    expect(result.allowedRiskInr).toBe(400);
    expect(result.affordable).toBe(false);
    expect(result.affordableLots).toBe(0);
  });

  it("blocks invalid capital and applies daily loss limit", () => {
    expect(calculateAffordableLots({ capitalInr: 100_000, premiumEntry: 100, premiumStop: 90, lotSize: 10 }).affordable).toBe(false);
    expect(hasHitDailyLossLimit(80_000, -1_200)).toBe(true);
    expect(hasHitDailyLossLimit(80_000, -500)).toBe(false);
  });
});

describe("evaluatePrecision15", () => {
  it("returns BUY_CALL when every gate passes", () => {
    const decision = evaluatePrecision15(bullishSnapshot());
    expect(decision.action).toBe("BUY_CALL");
    expect(decision.regime).toBe("BULL_TREND");
    expect(decision.score).toBe(100);
    expect(decision.rejectedReasons).toEqual([]);
  });

  it("returns BUY_PUT on a fully bearish snapshot", () => {
    const snapshot = bullishSnapshot();
    snapshot.spotIndicators15m = {
      ...snapshot.spotIndicators15m,
      ema20: 95, ema50: 100, ema200: 110,
      rsi14: 38, adx14: 30, plusDi14: 15, minusDi14: 35,
      macd: -1, macdSignal: -0.5, macdHistogram: -0.5, previousMacdHistogram: -0.2,
      supertrendDirection: "BEARISH",
      previousCandleHigh: 105, previousCandleLow: 101,
      lastClose: 100, vwap: 105,
    };
    snapshot.spotIndicators1h = { ...snapshot.spotIndicators1h, ema20: 98, ema50: 102, ema200: 110, lastClose: 100 };
    snapshot.futuresIndicators15m = { ...snapshot.futuresIndicators15m, vwap: 105 };
    const decision = evaluatePrecision15(snapshot);
    expect(decision.action).toBe("BUY_PUT");
    expect(decision.regime).toBe("BEAR_TREND");
  });

  it("returns HOLD with reasons when a hard gate fails despite high score", () => {
    const snapshot = bullishSnapshot();
    snapshot.spotIndicators15m = { ...snapshot.spotIndicators15m, rsi14: 80 };
    const decision = evaluatePrecision15(snapshot);
    expect(decision.action).toBe("HOLD");
    expect(decision.score).toBe(95);
    expect(decision.rejectedReasons).toContain("RSI is outside the call-entry range (55–68)");
  });

  it("rejects incomplete candles and stale data", () => {
    const incomplete = bullishSnapshot({ spot15m: [candle(30), { ...candle(15), complete: false }] });
    expect(evaluatePrecision15(incomplete).action).toBe("HOLD");
    expect(evaluatePrecision15(incomplete).rejectedReasons).toContain("15-minute candles are incomplete");

    const stale = bullishSnapshot();
    stale.spotIndicators15m = { ...stale.spotIndicators15m, dataAsOf: new Date(Date.now() - 300_000).toISOString() };
    expect(evaluatePrecision15(stale).action).toBe("HOLD");
    expect(evaluatePrecision15(stale).rejectedReasons).toContain("15-minute indicator snapshot is stale");
  });

  it("rejects signals while the market is closed", () => {
    expect(evaluatePrecision15(bullishSnapshot({ marketOpen: false })).action).toBe("HOLD");
  });
});
