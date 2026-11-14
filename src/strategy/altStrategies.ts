export type AltAction = "BUY_CALL" | "BUY_PUT" | null;

/**
 * Alternative entry rules evaluated on the latest completed 15m candle of the
 * current IST session. `dayCandles` must be today's completed candles in
 * chronological order (>=3). Returns the signal direction or null.
 *
 * Backtested ~positive on 6 months of NIFTY/SENSEX data; still unproven live.
 */
export function altEntryAction(
  mode: "vwap" | "gapfade",
  dayCandles: { open: number; high: number; low: number; close: number }[],
  prevDayClose: number,
  sessionVwap: number,
): AltAction {
  if (dayCandles.length < 3 || !(sessionVwap > 0) || !(prevDayClose > 0)) return null;
  const prev = dayCandles[dayCandles.length - 2]!;
  const cur = dayCandles[dayCandles.length - 1]!;

  if (mode === "vwap") {
    if (prev.close <= sessionVwap && cur.close > sessionVwap) return "BUY_CALL";
    if (prev.close >= sessionVwap && cur.close < sessionVwap) return "BUY_PUT";
    return null;
  }

  // gapfade: fade >0.4% opening gaps back through the day open
  const open = dayCandles[0]!.open;
  const gapPct = (open - prevDayClose) / prevDayClose;
  if (gapPct > 0.004 && prev.close >= open && cur.close < open) return "BUY_PUT";
  if (gapPct < -0.004 && prev.close <= open && cur.close > open) return "BUY_CALL";
  return null;
}
