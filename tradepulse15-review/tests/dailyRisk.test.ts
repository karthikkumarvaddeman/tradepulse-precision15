import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DailySignalLimiter } from "../src/application/dailySignalLimiter.js";
import { SignalStore } from "../src/application/signalStore.js";
import type { TradingSignal } from "../src/domain/types.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sampleSignal(id: string, symbol: "NIFTY" | "SENSEX" = "NIFTY"): TradingSignal {
  return {
    id, symbol, action: "BUY_CALL", status: "CANDIDATE", regime: "BULL_TREND", score: 100,
    reasons: [], rejectedReasons: [], candleTimestamp: "2026-01-05T04:45:00.000Z",
    createdAt: "2026-01-05T05:00:00.000Z",
  };
}

describe("daily recommendation limiter", () => {
  it("deduplicates each index/candle and limits both indices together", () => {
    const limiter = new DailySignalLimiter(2, 1);
    expect(limiter.canEmit("2026-01-05", "NIFTY", "c1")).toBe(true);
    limiter.record(sampleSignal("one"), "2026-01-05");
    limiter.markPositionOpen("NIFTY");
    expect(limiter.canEmit("2026-01-05", "SENSEX", "c2")).toBe(false);
    limiter.markPositionClosed("NIFTY");
    expect(limiter.canEmit("2026-01-05", "NIFTY", "2026-01-05T04:45:00.000Z")).toBe(false);
    expect(limiter.canEmit("2026-01-05", "SENSEX", "c2")).toBe(true);
    limiter.record(sampleSignal("two", "SENSEX"), "2026-01-05");
    expect(limiter.canEmit("2026-01-05", "NIFTY", "c3")).toBe(false);
  });

  it("marks a skipped-risk candle seen without consuming the actionable quota", () => {
    const limiter = new DailySignalLimiter(2, 1);
    limiter.record({ ...sampleSignal("skip"), status: "SKIPPED_RISK_BUDGET" }, "2026-01-05", false);
    expect(limiter.canEmit("2026-01-05", "NIFTY", "2026-01-05T04:45:00.000Z")).toBe(false);
    expect(limiter.canEmit("2026-01-05", "SENSEX", "new-candle")).toBe(true);
  });
});

describe("signal store realized P&L", () => {
  it("records close P&L once and sums only the requested local date", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tradepulse-test-"));
    tempDirs.push(dir);
    const store = new SignalStore(path.join(dir, "signals.json"));
    const signal = sampleSignal("signal-1");
    store.add(signal);
    expect(store.close(signal.id, -500, new Date("2026-01-05T07:00:00.000Z"))).toBe(true);
    expect(store.close(signal.id, -500, new Date("2026-01-05T07:05:00.000Z"))).toBe(false);
    expect(store.dailyRealizedPnl(new Date("2026-01-05T08:00:00.000Z"), "Asia/Kolkata")).toBe(-500);
    expect(store.dailyRealizedPnl(new Date("2026-01-06T08:00:00.000Z"), "Asia/Kolkata")).toBe(0);
  });
});
