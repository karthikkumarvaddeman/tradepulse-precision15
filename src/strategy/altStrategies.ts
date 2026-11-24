import { supertrend } from "../indicators/indicators.js";
import type { Candle } from "../domain/types.js";

export type AltAction = "BUY_CALL" | "BUY_PUT" | null;
export type AltStrategyMode = "vwap" | "gapfade" | "combo" | "combo-late" | "combo-regime" | "supertrend";

/**
 * Alternative entry rules evaluated on the latest completed 15m candle of the
 * current IST session. `dayCandles` must be today's completed candles in
 * chronological order (>=3). Returns the signal direction or null.
 *
 * Backtested ~positive on 6 months of NIFTY/SENSEX data; still unproven live.
 */
export function altEntryAction(
  mode: AltStrategyMode,
  dayCandles: { open: number; high: number; low: number; close: number }[],
  prevDayClose: number,
  sessionVwap: number,
  latestCandleEndMinutes?: number,
  prevDayRetPct = 0,
  history15m?: Candle[],
): AltAction {
  if (dayCandles.length < 3 || !(sessionVwap > 0) || !(prevDayClose > 0)) return null;
  const prev = dayCandles[dayCandles.length - 2]!;
  const cur = dayCandles[dayCandles.length - 1]!;
  const open = dayCandles[0]!.open;
  const gapPct = (open - prevDayClose) / prevDayClose;
  const isGapDay = Math.abs(gapPct) > 0.004;

  // combo-regime: regime gate by yesterday's day return.
  // calm (|ret| <= 0.4%) -> gaps are noise, fade them; skip VWAP.
  // trending (|ret| > 0.4%) -> don't fade gaps; late VWAP crosses only.
  if (mode === "combo-regime") {
    const calm = Math.abs(prevDayRetPct) <= 0.004;
    if (isGapDay) {
      if (!calm) return null;
      if (gapPct > 0.004 && prev.close >= open && cur.close < open && cur.close > prevDayClose) return "BUY_PUT";
      if (gapPct < -0.004 && prev.close <= open && cur.close > open && cur.close < prevDayClose) return "BUY_CALL";
      return null;
    }
    if (calm) return null;
    if (latestCandleEndMinutes !== undefined && latestCandleEndMinutes < 13 * 60) return null;
    if (prev.close <= sessionVwap && cur.close > sessionVwap) return "BUY_CALL";
    if (prev.close >= sessionVwap && cur.close < sessionVwap) return "BUY_PUT";
    return null;
  }

  // supertrend: 15m Supertrend(14,3) direction flip on trailing history
  // (chart-style calculation). 180d sweep: 73 trades, +2093 underlying pts.
  // Day-candles-only Supertrend was tested and rejected — without history the
  // bands never catch up and flips are missed (e.g. 2026-11-23 selloff).
  if (mode === "supertrend") {
    const series = (history15m?.length ? history15m : dayCandles) as Candle[];
    if (series.length < 15) return null;
    const nowSt = supertrend(series, 14, 3);
    const prevSt = supertrend(series.slice(0, -1), 14, 3);
    if (!nowSt || !prevSt || nowSt === prevSt) return null;
    return nowSt === "BULLISH" ? "BUY_CALL" : "BUY_PUT";
  }

  // gapfade: fade >0.4% opening gaps back toward previous day's close.
  // Only fire while price is still on the gap side of prevDayClose (target ahead).
  // In combo modes this rule owns gap days exclusively.
  if (mode === "gapfade" || ((mode === "combo" || mode === "combo-late") && isGapDay)) {
    if (gapPct > 0.004 && prev.close >= open && cur.close < open && cur.close > prevDayClose) return "BUY_PUT";
    if (gapPct < -0.004 && prev.close <= open && cur.close > open && cur.close < prevDayClose) return "BUY_CALL";
    return null;
  }

  // combo-late restricts the VWAP leg to candles ending at/after 13:00 IST —
  // backtest showed afternoon crosses carry the edge; midday crosses are noise.
  if (mode === "combo-late" && latestCandleEndMinutes !== undefined && latestCandleEndMinutes < 13 * 60) return null;

  if (prev.close <= sessionVwap && cur.close > sessionVwap) return "BUY_CALL";
  if (prev.close >= sessionVwap && cur.close < sessionVwap) return "BUY_PUT";
  return null;
}
