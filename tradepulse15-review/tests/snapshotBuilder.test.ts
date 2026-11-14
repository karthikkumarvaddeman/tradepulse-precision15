import { describe, expect, it } from "vitest";
import { buildFuturesIndicators } from "../src/application/snapshotBuilder.js";
import type { Candle } from "../src/domain/types.js";

function makeCandle(timestamp: string, volume: number): Candle {
  return { timestamp, open: 100, high: 101, low: 99, close: 100, volume, complete: true };
}

describe("futures volume baselines", () => {
  it("uses the 20 prior candles for SMA fallback when slot history is insufficient", () => {
    const base = Date.parse("2026-01-05T03:15:00.000Z"); // 08:45 IST
    const candles = Array.from({ length: 25 }, (_, index) => makeCandle(new Date(base + index * 15 * 60_000).toISOString(), index === 24 ? 2000 : 1000));
    const result = buildFuturesIndicators(candles, new Date("2026-01-05T09:30:00.000Z"), "Asia/Kolkata");
    expect(result).not.toBeNull();
    expect(result!.futuresVolume).toBe(2000);
    expect(result!.futuresVolumeSma20).toBe(1000);
    expect(result!.futuresVolumeSlotAvg).toBeUndefined();
  });

  it("calculates same-time-slot average from prior sessions only", () => {
    const previousSessions = Array.from({ length: 8 }, (_, index) => {
      const day = String(index + 1).padStart(2, "0");
      return makeCandle(`2025-01-${day}T09:15:00.000Z`, 100 + index); // 14:45 IST
    });
    const currentStart = Date.parse("2026-01-05T03:15:00.000Z");
    const currentSession = Array.from({ length: 25 }, (_, index) => makeCandle(
      new Date(currentStart + index * 15 * 60_000).toISOString(), index === 24 ? 2000 : 1000,
    ));
    const all = [...previousSessions, ...currentSession].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const result = buildFuturesIndicators(all, new Date("2026-01-05T09:30:00.000Z"), "Asia/Kolkata");
    expect(result).not.toBeNull();
    expect(result!.futuresVolumeSlotAvg).toBeCloseTo(103.5, 6);
  });
});
