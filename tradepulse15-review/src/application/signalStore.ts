import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { IndexSymbol, TradingSignal } from "../domain/types.js";
import { istDateKey } from "./marketClock.js";

const MAX_STORED_SIGNALS = 500;

interface ClosedTradeRecord {
  signalId: string;
  closedAt: string;
  realizedPnlInr: number;
}

interface StoreFile {
  signals: TradingSignal[];
  closedSignalIds: string[];
  closedTrades?: ClosedTradeRecord[];
}

/** Local JSON persistence for signals and manually reported realized P&L. */
export class SignalStore {
  private signals: TradingSignal[] = [];
  private readonly closedIds = new Set<string>();
  private readonly closedTrades = new Map<string, ClosedTradeRecord>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as StoreFile;
      this.signals = Array.isArray(parsed.signals) ? parsed.signals : [];
      for (const id of parsed.closedSignalIds ?? []) this.closedIds.add(id);
      for (const record of parsed.closedTrades ?? []) {
        if (record && typeof record.signalId === "string" && Number.isFinite(record.realizedPnlInr) && Number.isFinite(Date.parse(record.closedAt))) {
          this.closedTrades.set(record.signalId, record);
          this.closedIds.add(record.signalId);
        }
      }
    } catch (error) {
      // Fail closed: a damaged risk store must not silently reset daily caps or
      // realized P&L and then be overwritten by the next signal.
      throw new Error(`Could not read TradePulse signal store at ${this.filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private persist(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload: StoreFile = {
      signals: this.signals.slice(-MAX_STORED_SIGNALS),
      closedSignalIds: [...this.closedIds],
      closedTrades: [...this.closedTrades.values()],
    };
    writeFileSync(this.filePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
    try { chmodSync(this.filePath, 0o600); } catch { /* Windows ACLs govern access on Windows. */ }
  }

  add(signal: TradingSignal): void {
    const previous = this.signals;
    this.signals = [...this.signals, signal].slice(-MAX_STORED_SIGNALS);
    try { this.persist(); }
    catch (error) {
      this.signals = previous;
      throw new Error(`Could not persist signal; recommendation was not recorded: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  all(): TradingSignal[] { return [...this.signals]; }

  latestBySymbol(): Map<IndexSymbol, TradingSignal> {
    const map = new Map<IndexSymbol, TradingSignal>();
    for (const signal of this.signals) map.set(signal.symbol, signal);
    return map;
  }

  isClosed(id: string): boolean { return this.closedIds.has(id); }

  dismiss(id: string): boolean {
    const signal = this.signals.find((s) => s.id === id);
    if (!signal || signal.status !== "CANDIDATE" || this.closedIds.has(id)) return false;
    signal.status = "DECLINED";
    try { this.persist(); }
    catch (error) {
      signal.status = "CANDIDATE";
      throw new Error(`Could not persist dismissal; recommendation remains active: ${error instanceof Error ? error.message : String(error)}`);
    }
    return true;
  }

  close(id: string, realizedPnlInr: number, now = new Date()): boolean {
    const signal = this.signals.find((s) => s.id === id);
    if (!Number.isFinite(realizedPnlInr) || !Number.isFinite(now.getTime()) || !signal || signal.status !== "CANDIDATE" || this.closedIds.has(id)) return false;
    const previousStatus = signal.status;
    this.closedIds.add(id);
    signal.status = "CLOSED_MANUAL";
    const record = { signalId: id, closedAt: now.toISOString(), realizedPnlInr };
    this.closedTrades.set(id, record);
    try {
      this.persist();
    } catch (error) {
      this.closedIds.delete(id);
      this.closedTrades.delete(id);
      signal.status = previousStatus;
      throw new Error(`Could not persist realized P&L; signal remains open: ${error instanceof Error ? error.message : String(error)}`);
    }
    return true;
  }

  dailyRealizedPnl(date: Date, timeZone: string): number {
    const key = istDateKey(date, timeZone);
    let total = 0;
    for (const record of this.closedTrades.values()) {
      if (istDateKey(new Date(record.closedAt), timeZone) === key) total += record.realizedPnlInr;
    }
    return total;
  }

  /** Signals emitted on a given calendar date in the app timezone. */
  signalsOn(date: Date, timeZone: string): TradingSignal[] {
    const key = istDateKey(date, timeZone);
    return this.signals.filter((s) => istDateKey(new Date(s.createdAt), timeZone) === key);
  }

  static newId(): string { return randomUUID(); }
}
