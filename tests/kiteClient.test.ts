import { describe, expect, it } from "vitest";
import { normalizeKiteTimestamp } from "../src/broker/kiteClient.js";

describe("Kite timestamp normalization", () => {
  it("interprets timezone-less Kite timestamps as IST", () => {
    expect(normalizeKiteTimestamp("2026-11-14 09:15:00")).toBe("2026-11-14T03:45:00.000Z");
  });

  it("normalizes compact offsets and retains explicit timezone meaning", () => {
    expect(normalizeKiteTimestamp("2026-11-14T09:15:00+0530")).toBe("2026-11-14T03:45:00.000Z");
    expect(normalizeKiteTimestamp("2026-11-14T03:45:00Z")).toBe("2026-11-14T03:45:00.000Z");
  });
});
