import type { Candle } from "../domain/types.js";

export function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const window = values.slice(-period);
  return window.reduce((sum, value) => sum + value, 0) / period;
}

function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const multiplier = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = (values[i]! - prev) * multiplier + prev;
    out[i] = prev;
  }
  return out;
}

export function ema(values: number[], period: number): number | null {
  const series = emaSeries(values, period);
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] != null) return series[i]!;
  }
  return null;
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

function trueRange(candles: Candle[], index: number): number {
  const candle = candles[index]!;
  const previousClose = candles[index - 1]!.close;
  return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
}

/** Wilder-smoothed ATR aligned to candle indices; first valid value at index `period`. */
function wilderAtrSeries(candles: Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  let atr = 0;
  for (let i = 1; i <= period; i++) atr += trueRange(candles, i);
  atr /= period;
  out[period] = atr;
  for (let i = period + 1; i < candles.length; i++) {
    atr = (atr * (period - 1) + trueRange(candles, i)) / period;
    out[i] = atr;
  }
  return out;
}

export interface MacdResult {
  macd: number;
  signal: number;
  histogram: number;
  previousHistogram: number;
}

export function macd(values: number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): MacdResult | null {
  if (values.length < slowPeriod + signalPeriod) return null;
  const fast = emaSeries(values, fastPeriod);
  const slow = emaSeries(values, slowPeriod);
  const macdLine: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const f = fast[i];
    const s = slow[i];
    if (f != null && s != null) macdLine.push(f - s);
  }
  if (macdLine.length < signalPeriod + 1) return null;
  const signalSeries = emaSeries(macdLine, signalPeriod);
  let lastIndex = -1;
  for (let i = signalSeries.length - 1; i >= 0; i--) {
    if (signalSeries[i] != null) { lastIndex = i; break; }
  }
  if (lastIndex < 1) return null;
  const signal = signalSeries[lastIndex]!;
  const macdValue = macdLine[lastIndex]!;
  const previousMacdValue = macdLine[lastIndex - 1]!;
  const previousSignal = signalSeries[lastIndex - 1];
  return {
    macd: macdValue,
    signal,
    histogram: macdValue - signal,
    previousHistogram: previousSignal != null ? previousMacdValue - previousSignal : macdValue - signal,
  };
}

export interface AdxResult {
  adx: number;
  plusDi: number;
  minusDi: number;
}

/** Wilder's ADX/DI. Requires at least 2*period+1 candles. */
export function adx(candles: Candle[], period = 14): AdxResult | null {
  if (candles.length < 2 * period + 1) return null;
  const count = candles.length - 1;
  const tr = new Array<number>(count);
  const plusDm = new Array<number>(count);
  const minusDm = new Array<number>(count);
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const p = candles[i - 1]!;
    const upMove = c.high - p.high;
    const downMove = p.low - c.low;
    tr[i - 1] = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    plusDm[i - 1] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[i - 1] = downMove > upMove && downMove > 0 ? downMove : 0;
  }
  const smooth = (values: number[]): number[] => {
    const out: number[] = [];
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i]!;
    out.push(sum);
    for (let i = period; i < values.length; i++) {
      sum = sum - sum / period + values[i]!;
      out.push(sum);
    }
    return out;
  };
  const sTr = smooth(tr);
  const sPd = smooth(plusDm);
  const sMd = smooth(minusDm);
  const dx: number[] = [];
  for (let i = 0; i < sTr.length; i++) {
    const trValue = sTr[i]!;
    if (trValue === 0) continue;
    const plusDi = (100 * sPd[i]!) / trValue;
    const minusDi = (100 * sMd[i]!) / trValue;
    const diSum = plusDi + minusDi;
    if (diSum === 0) continue;
    dx.push((100 * Math.abs(plusDi - minusDi)) / diSum);
  }
  if (dx.length < period) return null;
  let adxValue = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dx.length; i++) {
    adxValue = (adxValue * (period - 1) + dx[i]!) / period;
  }
  const lastTr = sTr[sTr.length - 1]!;
  return {
    adx: adxValue,
    plusDi: lastTr === 0 ? 0 : (100 * sPd[sPd.length - 1]!) / lastTr,
    minusDi: lastTr === 0 ? 0 : (100 * sMd[sMd.length - 1]!) / lastTr,
  };
}

/**
 * Supertrend direction using the standard band-ratchet logic
 * (equivalent to the common Pine Script formulation).
 */
export function supertrend(candles: Candle[], period = 10, multiplier = 3): "BULLISH" | "BEARISH" | null {
  if (candles.length <= period) return null;
  const atrSeries = wilderAtrSeries(candles, period);
  if (atrSeries[candles.length - 1] == null) return null;
  let trend: 1 | -1 = 1;
  let prevUp = 0;
  let prevDn = 0;
  let started = false;
  for (let i = period; i < candles.length; i++) {
    const atrValue = atrSeries[i];
    if (atrValue == null) continue;
    const candle = candles[i]!;
    const hl2 = (candle.high + candle.low) / 2;
    let up = hl2 - multiplier * atrValue;
    let dn = hl2 + multiplier * atrValue;
    if (started) {
      const prevClose = candles[i - 1]!.close;
      up = prevClose > prevUp ? Math.max(up, prevUp) : up;
      dn = prevClose < prevDn ? Math.min(dn, prevDn) : dn;
      if (trend === -1 && candle.close > prevDn) trend = 1;
      else if (trend === 1 && candle.close < prevUp) trend = -1;
    }
    prevUp = up;
    prevDn = dn;
    started = true;
  }
  return trend === 1 ? "BULLISH" : "BEARISH";
}

export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
}

export function bollinger(values: number[], period = 20, deviations = 2): BollingerResult | null {
  if (values.length < period) return null;
  const window = values.slice(-period);
  const middle = window.reduce((sum, value) => sum + value, 0) / period;
  const variance = window.reduce((sum, value) => sum + (value - middle) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: middle + deviations * sd, middle, lower: middle - deviations * sd };
}

/** Session VWAP from typical price weighted by traded volume. Returns null for volume-less series (e.g. spot index). */
export function vwap(candles: Candle[]): number | null {
  let priceVolume = 0;
  let volume = 0;
  for (const candle of candles) {
    if (!candle.volume || candle.volume <= 0) continue;
    if (![candle.high, candle.low, candle.close].every(Number.isFinite)) continue;
    const typical = (candle.high + candle.low + candle.close) / 3;
    priceVolume += typical * candle.volume;
    volume += candle.volume;
  }
  return volume > 0 ? priceVolume / volume : null;
}

export function averageVolume(candles: Candle[], period = 20): number | null {
  const volumes = candles.map((candle) => candle.volume ?? 0);
  return sma(volumes, period);
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
