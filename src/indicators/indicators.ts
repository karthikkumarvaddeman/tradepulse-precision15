import type { Candle } from "../domain/types.js";

export function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const window = values.slice(-period);
  return window.reduce((sum, value) => sum + value, 0) / period;
}

export function ema(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const multiplier = 2 / (period + 1);
  return values.slice(period).reduce((prev, value) => (value - prev) * multiplier + prev, seed);
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i]! - values[i - 1]!;
    if (change >= 0) gains += change; else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i]! - values[i - 1]!;
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const ranges = candles.slice(1).map((candle, index) => {
    const previousClose = candles[index]!.close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });
  return sma(ranges, period);
}

export function relativeVolume(current: number, history: number[], period = 20): number | null {
  const average = sma(history, period);
  return average && average > 0 ? current / average : null;
}

export function isChronologicalAndComplete(candles: Candle[]): boolean {
  if (!candles.length || candles.some(c => !c.complete || ![c.open, c.high, c.low, c.close].every(Number.isFinite))) return false;
  for (let i = 1; i < candles.length; i++) {
    if (Date.parse(candles[i]!.timestamp) <= Date.parse(candles[i - 1]!.timestamp)) return false;
  }
  return true;
}
