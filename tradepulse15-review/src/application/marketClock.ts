export interface ZonedParts {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
  weekday: string;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false, weekday: "short",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"), month: get("month"), day: get("day"),
    hour: get("hour") % 24, minute: get("minute"), second: get("second"),
    weekday: parts.find((p) => p.type === "weekday")?.value ?? "",
  };
}

function toMinutes(parts: ZonedParts): number {
  return parts.hour * 60 + parts.minute + parts.second / 60;
}

const MARKET_OPEN_MIN = 9 * 60 + 15;
const MARKET_CLOSE_MIN = 15 * 60 + 30;
const ENTRY_START_MIN = 9 * 60 + 45;
const ENTRY_END_MIN = 14 * 60 + 30;

export function isMarketOpen(now: Date, timeZone: string): boolean {
  const p = zonedParts(now, timeZone);
  if (p.weekday === "Sat" || p.weekday === "Sun") return false;
  const minutes = toMinutes(p);
  return minutes >= MARKET_OPEN_MIN && minutes < MARKET_CLOSE_MIN;
}

export function isWithinEntryWindow(now: Date, timeZone: string): boolean {
  const p = zonedParts(now, timeZone);
  if (p.weekday === "Sat" || p.weekday === "Sun") return false;
  const minutes = toMinutes(p);
  return minutes >= ENTRY_START_MIN && minutes < ENTRY_END_MIN;
}

/** Drop candles whose interval has not fully completed by `now`. */
export function completedCandles<T extends { timestamp: string }>(candles: T[], intervalMinutes: number, now: Date): T[] {
  const cutoff = now.getTime();
  return candles.filter((c) => Date.parse(c.timestamp) + intervalMinutes * 60_000 <= cutoff);
}

export function istDateKey(date: Date, timeZone = "Asia/Kolkata"): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
