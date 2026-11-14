import { describe, expect, it } from "vitest";
import { adx, atr, bollinger, ema, isChronologicalAndComplete, macd, rsi, supertrend, vwap } from "../src/indicators/indicators.js";
import type { Candle } from "../src/domain/types.js";

function makeCandles(count: number, start: number, step: number, volume = 1000): Candle[] {
  const base = Date.UTC(2026, 0, 5, 3, 45);
  return Array.from({ length: count }, (_, i) => {
    const close = start + i * step;
    return {
      timestamp: new Date(base + i * 15 * 60_000).toISOString(),
      open: close - step / 4,
      high: close + Math.abs(step) / 2 + 0.5,
      low: close - Math.abs(step) / 2 - 0.5,
      close,
      volume,
      complete: true,
    };
  });
}

describe("indicators", () => {
  it("computes EMA and RSI on monotonic series", () => {
    const up = Array.from({ length: 60 }, (_, i) => i + 1);
    const down = Array.from({ length: 60 }, (_, i) => 60 - i);
    expect(ema(up, 20)).toBeGreaterThan(50);
    expect(rsi(up, 14)).toBe(100);
    expect(rsi(down, 14)).toBe(0);
    expect(rsi(Array.from({ length: 20 }, () => 5), 14)).toBe(50);
    expect(rsi(up.slice(0, 10), 14)).toBeNull();
  });

  it("computes ATR and rejects short input", () => {
    const candles = makeCandles(30, 100, 1);
    expect(atr(candles, 14)).toBeGreaterThan(0);
    expect(atr(candles.slice(0, 10), 14)).toBeNull();
  });

  it("computes MACD histogram and previous histogram", () => {
    const values = Array.from({ length: 80 }, (_, i) => 100 + i * 0.5 + Math.sin(i / 3) * 2);
    const result = macd(values);
    expect(result).not.toBeNull();
    expect(Number.isFinite(result!.macd)).toBe(true);
    expect(Number.isFinite(result!.signal)).toBe(true);
    expect(Number.isFinite(result!.histogram)).toBe(true);
    expect(Number.isFinite(result!.previousHistogram)).toBe(true);
    expect(macd(values.slice(0, 20))).toBeNull();
  });

  it("computes ADX/DI with correct directional ordering", () => {
    const up = makeCandles(60, 100, 2);
    const down = makeCandles(60, 100, -2);
    const upAdx = adx(up);
    const downAdx = adx(down);
    expect(upAdx).not.toBeNull();
    expect(downAdx).not.toBeNull();
    expect(upAdx!.plusDi).toBeGreaterThan(upAdx!.minusDi);
    expect(downAdx!.minusDi).toBeGreaterThan(downAdx!.plusDi);
    expect(upAdx!.adx).toBeGreaterThan(0);
    expect(adx(up.slice(0, 10))).toBeNull();
  });

  it("detects supertrend direction on trending series", () => {
    expect(supertrend(makeCandles(60, 100, 1))).toBe("BULLISH");
    expect(supertrend(makeCandles(60, 100, -1))).toBe("BEARISH");
    expect(supertrend(makeCandles(10, 100, 1))).toBeNull();
  });

  it("computes Bollinger bands around the mean", () => {
    const values = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 5);
    const bands = bollinger(values, 20, 2)!;
    expect(bands.upper).toBeGreaterThan(bands.middle);
    expect(bands.middle).toBeGreaterThan(bands.lower);
    expect(bands.upper - bands.lower).toBeCloseTo(2 * (bands.upper - bands.middle), 5);
    expect(bollinger(values.slice(0, 10))).toBeNull();
  });

  it("computes VWAP weighted by volume and returns null without volume", () => {
    const candles: Candle[] = [
      { timestamp: "2026-01-05T04:00:00Z", open: 10, high: 10, low: 10, close: 10, volume: 1, complete: true },
      { timestamp: "2026-01-05T04:15:00Z", open: 20, high: 20, low: 20, close: 20, volume: 3, complete: true },
    ];
    expect(vwap(candles)).toBeCloseTo(17.5, 5);
    expect(vwap(candles.map((c) => ({ ...c, volume: undefined })))).toBeNull();
  });

  it("rejects non-chronological or incomplete candles", () => {
    const candles = makeCandles(5, 100, 1);
    expect(isChronologicalAndComplete(candles)).toBe(true);
    expect(isChronologicalAndComplete([{ ...candles[0]!, complete: false }])).toBe(false);
    expect(isChronologicalAndComplete([candles[1]!, candles[0]!])).toBe(false);
    expect(isChronologicalAndComplete([{ ...candles[0]!, high: 1 }])).toBe(false);
  });
});
