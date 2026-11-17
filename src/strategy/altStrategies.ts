export type AltAction = "BUY_CALL" | "BUY_PUT" | null;

/**
 * Alternative entry rules evaluated on the latest completed 15m candle of the
 * current IST session. `dayCandles` must be today's completed candles in
 * chronological order (>=3). Returns the signal direction or null.
 *
 * Backtested ~positive on 6 months of NIFTY/SENSEX data; still unproven live.
 */
export function altEntryAction(
  mode: "vwap" | "gapfade" | "combo" | "combo-late",
  dayCandles: { open: number; high: number; low: number; close: number }[],
  prevDayClose: number,
  sessionVwap: number,
  latestCandleEndMinutes?: number,
): AltAction {
  if (dayCandles.length < 3 || !(sessionVwap > 0) || !(prevDayClose > 0)) return null;
  const prev = dayCandles[dayCandles.length - 2]!;
  const cur = dayCandles[dayCandles.length - 1]!;
  const open = dayCandles[0]!.open;
  const gapPct = (open - prevDayClose) / prevDayClose;
  const isGapDay = Math.abs(gapPct) > 0.004;

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
