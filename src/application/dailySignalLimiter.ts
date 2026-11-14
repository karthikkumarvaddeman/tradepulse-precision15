import type { IndexSymbol, TradingSignal } from "../domain/types.js";

/** In-memory guard; SignalStore is the durable source restored on startup. */
export class DailySignalLimiter {
  private readonly emittedByDate = new Map<string, Set<string>>();
  private readonly seenByDate = new Map<string, Set<string>>();
  private readonly openSymbols = new Set<IndexSymbol>();

  constructor(private readonly maxSignalsPerDay = 2, private readonly maxOpenPositions = 1) {}

  canEmit(dateKey: string, symbol: IndexSymbol, candleTimestamp: string): boolean {
    const key = `${symbol}:${candleTimestamp}`;
    const seen = this.seenByDate.get(dateKey) ?? new Set<string>();
    const emitted = this.emittedByDate.get(dateKey) ?? new Set<string>();
    return !seen.has(key) && emitted.size < this.maxSignalsPerDay && this.openSymbols.size < this.maxOpenPositions;
  }

  /**
   * Mark an evaluation as seen to suppress repeat notifications for the same
   * candle. Risk-budget skips do not consume the actionable daily quota.
   */
  record(signal: TradingSignal, dateKey: string, countTowardsDailyCap = true): void {
    const key = `${signal.symbol}:${signal.candleTimestamp}`;
    const seen = this.seenByDate.get(dateKey) ?? new Set<string>();
    seen.add(key);
    this.seenByDate.set(dateKey, seen);
    if (countTowardsDailyCap) {
      const emitted = this.emittedByDate.get(dateKey) ?? new Set<string>();
      emitted.add(key);
      this.emittedByDate.set(dateKey, emitted);
    }
  }

  markPositionOpen(symbol: IndexSymbol): void { this.openSymbols.add(symbol); }
  markPositionClosed(symbol: IndexSymbol): void { this.openSymbols.delete(symbol); }
}
