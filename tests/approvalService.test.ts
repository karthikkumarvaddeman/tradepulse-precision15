import { describe, expect, it } from "vitest";
import { ApprovalService, type ApprovalBinding } from "../src/approval/approvalService.js";
import type { TradingSignal } from "../src/domain/types.js";

const signal: TradingSignal = {
  id: "sig-1",
  symbol: "NIFTY",
  action: "BUY_CALL",
  status: "READY_FOR_APPROVAL",
  regime: "BULL_TREND",
  score: 100,
  reasons: [],
  rejectedReasons: [],
  candleTimestamp: "2026-01-05T04:00:00Z",
  createdAt: "2026-01-05T04:15:10Z",
};

const binding = {
  exchange: "NFO" as const,
  tradingsymbol: "NIFTY25JAN24500CE",
  quantity: 75,
  limitPrice: 142.5,
};

const expected: ApprovalBinding = { signalId: "sig-1", ...binding };

describe("ApprovalService", () => {
  it("consumes a valid token exactly once", () => {
    const service = new ApprovalService();
    const record = service.create(signal, binding);
    expect(service.consume(record.token, expected)).toBe(true);
    expect(service.consume(record.token, expected)).toBe(false);
  });

  it("rejects expired tokens", () => {
    const service = new ApprovalService();
    const record = service.create(signal, binding, -1);
    expect(service.consume(record.token, expected)).toBe(false);
    expect(service.inspect(record.token)).toBeNull();
  });

  it("rejects mismatched contract, quantity, or limit price", () => {
    const service = new ApprovalService();
    const record = service.create(signal, binding);
    expect(service.consume(record.token, { ...expected, tradingsymbol: "NIFTY25JAN24600CE" })).toBe(false);
    expect(service.consume(record.token, { ...expected, quantity: 150 })).toBe(false);
    expect(service.consume(record.token, { ...expected, limitPrice: 143 })).toBe(false);
    expect(service.consume(record.token, { ...expected, exchange: "BFO" })).toBe(false);
    expect(service.consume(record.token, { ...expected, signalId: "other" })).toBe(false);
    // failed attempts must not burn the token
    expect(service.consume(record.token, expected)).toBe(true);
  });
});
