import { describe, expect, it } from "vitest";
import { calculateAffordableLots, hasHitDailyLossLimit } from "../src/risk/riskManager.js";
import { getExchangeForIndex } from "../src/strategy/precisionStrategy.js";

describe("Precision 15 foundations", () => {
  it("maps NIFTY and SENSEX to their derivatives exchanges", () => {
    expect(getExchangeForIndex("NIFTY")).toBe("NFO");
    expect(getExchangeForIndex("SENSEX")).toBe("BFO");
  });

  it("rejects a lot that exceeds the 0.5% risk allowance", () => {
    const result = calculateAffordableLots({ capitalInr: 80_000, premiumEntry: 120, premiumStop: 100, lotSize: 25, estimatedCostsPerLot: 30, slippageBufferPerLot: 20 });
    expect(result.allowedRiskInr).toBe(400);
    expect(result.affordable).toBe(false);
    expect(result.affordableLots).toBe(0);
  });

  it("blocks invalid capital and applies daily loss limit", () => {
    expect(calculateAffordableLots({ capitalInr: 100_000, premiumEntry: 100, premiumStop: 90, lotSize: 10 }).affordable).toBe(false);
    expect(hasHitDailyLossLimit(80_000, -1_200)).toBe(true);
    expect(hasHitDailyLossLimit(80_000, -500)).toBe(false);
  });
});
