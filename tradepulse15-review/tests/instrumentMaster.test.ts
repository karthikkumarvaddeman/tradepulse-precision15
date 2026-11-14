import { describe, expect, it } from "vitest";
import { listOptionContracts, nearestExpiry, nearestOptionExpiry, parseInstrumentCsv, type Instrument } from "../src/broker/instrumentMaster.js";

const NOW = new Date("2026-01-05T05:00:00.000Z");

function instrument(overrides: Partial<Instrument>): Instrument {
  return {
    instrumentToken: 1, tradingsymbol: "NIFTY", name: "NIFTY", expiry: "", strike: 0,
    tickSize: 0.05, lotSize: 0, instrumentType: "INDEX", segment: "NSE", exchange: "NSE",
    ...overrides,
  };
}

describe("instrument master parsing and expiry selection", () => {
  it("parses quoted CSV fields containing commas and escaped quotes", () => {
    const csv = [
      "instrument_token,tradingsymbol,name,expiry,strike,tick_size,lot_size,instrument_type,segment",
      '12345,"NIFTY 50","NIFTY, 50",,0,0.05,0,INDEX,NSE',
      '12346,"NIFTY26JAN25000CE","NIFTY",2026-01-08,25000,0.05,65,CE,NFO',
    ].join("\n");
    const parsed = parseInstrumentCsv(csv, "NFO");
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.name).toBe("NIFTY, 50");
    expect(parsed[1]!.instrumentToken).toBe(12346);
  });

  it("selects the nearest option expiry independently of futures expiry", () => {
    const master = [
      instrument({ instrumentType: "FUT", exchange: "NFO", segment: "NFO-FUT", expiry: "2026-01-29", tradingsymbol: "NIFTY26JANFUT", lotSize: 65 }),
      instrument({ instrumentType: "CE", exchange: "NFO", segment: "NFO-OPT", expiry: "2026-01-08", tradingsymbol: "NIFTY26JAN25000CE", strike: 25000, lotSize: 65 }),
      instrument({ instrumentType: "CE", exchange: "NFO", segment: "NFO-OPT", expiry: "2026-01-29", tradingsymbol: "NIFTY26JAN25000CE2", strike: 25000, lotSize: 65 }),
      instrument({ instrumentType: "PE", exchange: "NFO", segment: "NFO-OPT", expiry: "2026-01-08", tradingsymbol: "NIFTY26JAN25000PE", strike: 25000, lotSize: 65 }),
    ];
    expect(nearestExpiry(master, "NIFTY", "NFO", NOW)).toBe("2026-01-29");
    expect(nearestOptionExpiry(master, "NIFTY", "CE", NOW)).toBe("2026-01-08");
    expect(listOptionContracts(master, "NIFTY", "CE", 25010, 0.02, NOW).map((i) => i.expiry)).toEqual(["2026-01-08"]);
  });
});
