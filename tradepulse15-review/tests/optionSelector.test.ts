import { describe, expect, it } from "vitest";
import { chooseLiquidOption } from "../src/options/optionSelector.js";
import type { OptionCandidate } from "../src/domain/types.js";

const NOW = new Date("2026-01-05T05:00:00.000Z");

function option(overrides: Partial<OptionCandidate> = {}): OptionCandidate {
  return {
    exchange: "NFO", tradingsymbol: "NIFTY26JAN25000CE", instrumentToken: 123,
    underlying: "NIFTY", optionType: "CE", expiry: "2026-01-08", strike: 25000,
    lotSize: 65, tickSize: 0.05, ltp: 100, bid: 99.5, ask: 100,
    volume: 10000, openInterest: 5000, quoteAsOf: NOW.toISOString(),
    ...overrides,
  };
}

const rules = {
  underlying: "NIFTY" as const, optionType: "CE" as const, spotPrice: 25010,
  now: NOW, maxSpreadPercent: 1, maxQuoteAgeMs: 120_000,
  minimumVolume: 1000, minimumOpenInterest: 500,
};

describe("option quote selection", () => {
  it("accepts a fresh, liquid, correctly routed near-ATM ITM contract", () => {
    expect(chooseLiquidOption([option()], rules)?.tradingsymbol).toBe("NIFTY26JAN25000CE");
  });

  it("fails closed on missing, stale, or future quote timestamps", () => {
    expect(chooseLiquidOption([option({ quoteAsOf: "" })], rules)).toBeNull();
    expect(chooseLiquidOption([option({ quoteAsOf: new Date(NOW.getTime() - 180_000).toISOString() })], rules)).toBeNull();
    expect(chooseLiquidOption([option({ quoteAsOf: new Date(NOW.getTime() + 1000).toISOString() })], rules)).toBeNull();
  });

  it("rejects crossed, wide, illiquid, and wrong-exchange options", () => {
    expect(chooseLiquidOption([option({ ask: 99 })], rules)).toBeNull();
    expect(chooseLiquidOption([option({ bid: 95, ask: 100 })], rules)).toBeNull();
    expect(chooseLiquidOption([option({ volume: 1 })], rules)).toBeNull();
    expect(chooseLiquidOption([option({ exchange: "BFO" })], rules)).toBeNull();
  });
});
