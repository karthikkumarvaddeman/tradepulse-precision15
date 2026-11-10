import type { IndexSymbol, TradingSignal } from "../domain/types.js";

/** In-memory starter only. Devin must replace with persistent, session-aware storage. */
export class DailySignalLimiter {
  private readonly emittedByDate = new Map<string, Set<string>>();
  private readonly openSymbols = new Set<IndexSymbol>();

  constructor(private readonly maxSignalsPerDay = 2, private readonly maxOpenPositions = 1) {}

  canEmit(dateKey: string, symbol: IndexSymbol, candleTimestamp: string): boolean {
    const ids = this.emittedByDate.get(dateKey) ?? new Set<string>();
    const key = `${symbol}:${candleTimestamp}`;
    return ids.size < this.maxSignalsPerDay && !ids.has(key) && this.openSymbols.size < this.maxOpenPositions;
  }

  record(signal: TradingSignal, dateKey: string): void {
    const ids = this.emittedByDate.get(dateKey) ?? new Set<string>();
    ids.add(`${signal.symbol}:${signal.candleTimestamp}`);
    this.emittedByDate.set(dateKey, ids);
  }

  markPositionOpen(symbol: IndexSymbol): void { this.openSymbols.add(symbol); }
  markPositionClosed(symbol: IndexSymbol): void { this.openSymbols.delete(symbol); }
}
