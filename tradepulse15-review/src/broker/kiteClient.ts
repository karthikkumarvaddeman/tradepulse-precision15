import crypto from "node:crypto";

const KITE_BASE = "https://api.kite.trade";
const KITE_VERSION = "3";

export interface KiteCredentials {
  apiKey: string;
  apiSecret?: string;
  accessToken?: string;
}

export class KiteApiError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
    this.name = "KiteApiError";
  }
}

async function kiteFetch<T>(credentials: KiteCredentials, method: "GET" | "POST", path: string, options: { query?: Record<string, string>; body?: Record<string, string> } = {}): Promise<T> {
  if (!credentials.apiKey) {
    throw new KiteApiError("Kite API key is not configured. Set KITE_API_KEY.", 0);
  }
  const url = new URL(`${KITE_BASE}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method,
    headers: {
      "X-Kite-Version": KITE_VERSION,
      ...(credentials.accessToken ? { Authorization: `token ${credentials.apiKey}:${credentials.accessToken}` } : {}),
      ...(options.body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: options.body ? new URLSearchParams(options.body).toString() : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new KiteApiError(`Kite returned a non-JSON response (HTTP ${response.status}).`, response.status);
  }
  const envelope = payload as { status?: string; message?: string; data?: unknown };
  if (!response.ok || envelope.status === "error") {
    throw new KiteApiError(`Kite API error: ${envelope.message ?? `HTTP ${response.status}`}`, response.status, payload);
  }
  return payload as T;
}

/** Exchange instrument master as CSV text. Cached per exchange by the caller. */
export async function fetchInstrumentCsv(credentials: KiteCredentials, exchange: string): Promise<string> {
  const response = await fetch(`${KITE_BASE}/instruments/${exchange}`, {
    headers: {
      "X-Kite-Version": KITE_VERSION,
      ...(credentials.accessToken ? { Authorization: `token ${credentials.apiKey}:${credentials.accessToken}` } : {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new KiteApiError(`Instrument download for ${exchange} failed (HTTP ${response.status}).`, response.status);
  }
  return response.text();
}

export interface KiteCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openInterest?: number;
}

interface HistoricalResponse {
  data: { candles: [string, number, number, number, number, number, number][] };
}

/** Kite requires "YYYY-MM-DD HH:MM:SS" in exchange local time (IST). */
function fmtKiteDateTime(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

/** Kite timestamps may be local IST text or include a compact +0530 offset. */
export function normalizeKiteTimestamp(ts: string): string {
  const trimmed = ts.trim().replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(trimmed) ? trimmed : `${trimmed}+05:30`;
  const millis = Date.parse(withZone);
  if (!Number.isFinite(millis)) throw new Error(`Invalid Kite timestamp: ${ts}`);
  return new Date(millis).toISOString();
}

/** Fetch historical candles. `interval` is a Kite interval such as "15minute" or "60minute". */
export async function fetchHistoricalCandles(
  credentials: KiteCredentials,
  instrumentToken: number,
  interval: string,
  from: Date,
  to: Date,
  includeOi = false,
  timeZone = "Asia/Kolkata",
): Promise<KiteCandle[]> {
  const payload = await kiteFetch<HistoricalResponse>(credentials, "GET",
    `/instruments/historical/${instrumentToken}/${interval}`,
    { query: { from: fmtKiteDateTime(from, timeZone), to: fmtKiteDateTime(to, timeZone), ...(includeOi ? { oi: "1" } : {}) } });
  return payload.data.candles.map(([ts, open, high, low, close, volume, oi]) => ({
    timestamp: new Date(normalizeKiteTimestamp(ts)).toISOString(),
    open, high, low, close, volume,
    ...(includeOi ? { openInterest: oi } : {}),
  }));
}

export interface KiteQuote {
  instrument_token: number;
  timestamp?: string;
  last_trade_time?: string;
  last_price: number;
  volume: number;
  buy_quantity: number;
  sell_quantity: number;
  oi?: number;
  oi_day_high?: number;
  oi_day_low?: number;
  depth?: {
    buy: { price: number; quantity: number; orders: number }[];
    sell: { price: number; quantity: number; orders: number }[];
  };
}

/** Fetch quotes for keys like "NFO:SYMBOL". Returns map keyed by the same string. */
export async function fetchQuotes(credentials: KiteCredentials, keys: string[]): Promise<Record<string, KiteQuote>> {
  if (!keys.length) return {};
  const query = keys.map((key) => `i=${encodeURIComponent(key)}`).join("&");
  const payload = await kiteFetch<{ data: Record<string, KiteQuote> }>(credentials, "GET", `/quote?${query}`);
  const normalized: Record<string, KiteQuote> = {};
  for (const [key, quote] of Object.entries(payload.data)) {
    normalized[key] = {
      ...quote,
      timestamp: quote.timestamp ? normalizeKiteTimestamp(quote.timestamp) : undefined,
      last_trade_time: quote.last_trade_time ? normalizeKiteTimestamp(quote.last_trade_time) : undefined,
    };
  }
  return normalized;
}

/** Generate the login URL the user must open daily to obtain a request_token. */
export function kiteLoginUrl(apiKey: string): string {
  return `https://kite.zerodha.com/connect/login?api_key=${encodeURIComponent(apiKey)}&v=3`;
}

/** Exchange a request_token for a daily access_token. Requires api_secret. */
export async function requestAccessToken(credentials: KiteCredentials, requestToken: string): Promise<{ accessToken: string; userId: string; loginTime: string }> {
  if (!credentials.apiSecret) throw new KiteApiError("KITE_API_SECRET is required to generate an access token.", 0);
  const checksum = crypto.createHash("sha256")
    .update(`${credentials.apiKey}${requestToken}${credentials.apiSecret}`)
    .digest("hex");
  const payload = await kiteFetch<{ data: { access_token: string; user_id: string; login_time: string } }>(
    { apiKey: credentials.apiKey },
    "POST",
    "/session/token",
    { body: { api_key: credentials.apiKey, request_token: requestToken, checksum } },
  );
  return { accessToken: payload.data.access_token, userId: payload.data.user_id, loginTime: payload.data.login_time };
}
