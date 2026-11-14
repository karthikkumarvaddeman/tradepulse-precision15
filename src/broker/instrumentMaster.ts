import type { IndexSymbol, OptionType } from "../domain/types.js";
import { fetchInstrumentCsv, type KiteCredentials } from "./kiteClient.js";

export interface Instrument {
  instrumentToken: number;
  tradingsymbol: string;
  name: string;
  expiry: string;
  strike: number;
  tickSize: number;
  lotSize: number;
  instrumentType: string;
  segment: string;
  exchange: string;
}

const SEGMENT_INDEX: Record<IndexSymbol, { exchange: string; match: (i: Instrument) => boolean }> = {
  NIFTY: { exchange: "NSE", match: (i) => i.tradingsymbol === "NIFTY 50" || (i.name === "NIFTY" && !i.expiry && !i.strike && i.tradingsymbol.includes("NIFTY")) },
  SENSEX: { exchange: "BSE", match: (i) => i.tradingsymbol === "SENSEX" || (i.name === "SENSEX" && !i.expiry && !i.strike) },
};

export function parseInstrumentCsv(csv: string, exchange: string): Instrument[] {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0]!.split(",");
  const col = (row: string[], name: string) => {
    const idx = header.indexOf(name);
    const raw = idx >= 0 ? row[idx] ?? "" : "";
    return raw.replace(/^"|"$/g, "");
  };
  const instruments: Instrument[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const row = line.split(",");
    const token = Number(col(row, "instrument_token"));
    if (!Number.isFinite(token) || token <= 0) continue;
    instruments.push({
      instrumentToken: token,
      tradingsymbol: col(row, "tradingsymbol"),
      name: col(row, "name"),
      expiry: col(row, "expiry"),
      strike: Number(col(row, "strike")) || 0,
      tickSize: Number(col(row, "tick_size")) || 0.05,
      lotSize: Number(col(row, "lot_size")) || 0,
      instrumentType: col(row, "instrument_type"),
      segment: col(row, "segment"),
      exchange,
    });
  }
  return instruments;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { fetchedAt: number; instruments: Instrument[] }>();

export async function getInstruments(credentials: KiteCredentials, exchange: string, forceRefresh = false): Promise<Instrument[]> {
  const hit = cache.get(exchange);
  if (!forceRefresh && hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.instruments;
  const csv = await fetchInstrumentCsv(credentials, exchange);
  const instruments = parseInstrumentCsv(csv, exchange);
  cache.set(exchange, { fetchedAt: Date.now(), instruments });
  return instruments;
}

export function resolveIndexInstrument(instruments: Instrument[], symbol: IndexSymbol): Instrument {
  const { match } = SEGMENT_INDEX[symbol];
  const found = instruments.find((i) => match(i));
  if (!found) throw new Error(`Could not resolve ${symbol} index instrument from ${SEGMENT_INDEX[symbol].exchange} master.`);
  return found;
}

function istDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Nearest expiry on or after today (IST). Returns YYYY-MM-DD. */
export function nearestExpiry(instruments: Instrument[], name: string, exchange: string, now = new Date()): string {
  const today = istDateKey(now);
  const expiries = [...new Set(
    instruments
      .filter((i) => i.exchange === exchange && i.name === name && i.instrumentType === "FUT" && i.expiry >= today)
      .map((i) => i.expiry),
  )].sort();
  if (!expiries.length) throw new Error(`No ${name} futures expiry found on ${exchange}.`);
  return expiries[0]!;
}

export function resolveFuturesInstrument(instruments: Instrument[], symbol: IndexSymbol, now = new Date()): Instrument {
  const exchange = symbol === "NIFTY" ? "NFO" : "BFO";
  const expiry = nearestExpiry(instruments, symbol, exchange, now);
  const found = instruments.find((i) =>
    i.exchange === exchange && i.name === symbol && i.instrumentType === "FUT" && i.expiry === expiry);
  if (!found) throw new Error(`Could not resolve ${symbol} futures for expiry ${expiry} on ${exchange}.`);
  return found;
}

/** Option contracts for a symbol/expiry/type near the spot price, with no quote data yet. */
export function listOptionContracts(
  instruments: Instrument[],
  symbol: IndexSymbol,
  optionType: OptionType,
  spotPrice: number,
  maxStrikeDistancePct = 0.02,
): Instrument[] {
  const exchange = symbol === "NIFTY" ? "NFO" : "BFO";
  const expiry = nearestExpiry(instruments, symbol, exchange);
  const band = spotPrice * maxStrikeDistancePct;
  return instruments
    .filter((i) =>
      i.exchange === exchange && i.name === symbol && i.instrumentType === optionType &&
      i.expiry === expiry && i.strike > 0 && Math.abs(i.strike - spotPrice) <= band && i.lotSize > 0)
    .sort((a, b) => Math.abs(a.strike - spotPrice) - Math.abs(b.strike - spotPrice))
    .slice(0, 40);
}
