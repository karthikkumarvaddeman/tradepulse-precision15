import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { IndexSymbol, TradingSignal } from "../domain/types.js";
import { istDateKey } from "./marketClock.js";

const MAX_STORED_SIGNALS = 500;

interface StoreFile {
  signals: TradingSignal[];
  closedSignalIds: string[];
}

/** Local JSON persistence for signals and manual close bookkeeping. Single-user local app. */
export class SignalStore {
  private signals: TradingSignal[] = [];
  private readonly closedIds = new Set<string>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as StoreFile;
      this.signals = Array.isArray(parsed.signals) ? parsed.signals : [];
      for (const id of parsed.closedSignalIds ?? []) this.closedIds.add(id);
    } catch {
      this.signals = [];
    }
  }

  private persist(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        mkdirSync(path.dirname(this.filePath), { recursive: true });
        const payload: StoreFile = { signals: this.signals.slice(-MAX_STORED_SIGNALS), closedSignalIds: [...this.closedIds] };
        writeFileSync(this.filePath, JSON.stringify(payload, null, 2));
      } catch {
        // persistence failure must not break signal generation
      }
    }, 250);
    this.saveTimer.unref?.();
  }

  add(signal: TradingSignal): void {
    this.signals.push(signal);
    if (this.signals.length > MAX_STORED_SIGNALS) this.signals = this.signals.slice(-MAX_STORED_SIGNALS);
    this.persist();
  }

  all(): TradingSignal[] {
    return [...this.signals];
  }

  latestBySymbol(): Map<IndexSymbol, TradingSignal> {
    const map = new Map<IndexSymbol, TradingSignal>();
    for (const signal of this.signals) map.set(signal.symbol, signal);
    return map;
  }

  isClosed(id: string): boolean {
    return this.closedIds.has(id);
  }

  close(id: string): boolean {
    if (!this.signals.some((s) => s.id === id)) return false;
    this.closedIds.add(id);
    this.persist();
    return true;
  }

  /** Signals emitted on a given calendar date in the app timezone. */
  signalsOn(date: Date, timeZone: string): TradingSignal[] {
    const key = istDateKey(date, timeZone);
    return this.signals.filter((s) => istDateKey(new Date(s.createdAt), timeZone) === key);
  }

  static newId(): string {
    return randomUUID();
  }
}
