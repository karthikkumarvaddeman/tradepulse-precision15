import { env } from "../src/config/env.js";
import { fetchInstrumentCsv, fetchHistoricalCandles } from "../src/broker/kiteClient.js";
import { getInstruments, resolveIndexInstrument } from "../src/broker/instrumentMaster.js";

const creds = { apiKey: env.KITE_API_KEY ?? "", accessToken: env.KITE_ACCESS_TOKEN };
const nse = await getInstruments(creds, "NSE");
const idx = resolveIndexInstrument(nse, "NIFTY");
console.log("token:", idx.instrumentToken);

const now = new Date();
const attempts: [string, Date, Date][] = [
  ["utc-no-sec 5d", new Date(now.getTime() - 5 * 86400e3), now],
  ["ist-ish 5d", new Date(now.getTime() - 5 * 86400e3 + 5.5 * 3600e3), new Date(now.getTime() + 5.5 * 3600e3)],
  ["1d", new Date(now.getTime() - 86400e3), now],
];
for (const [label, from, to] of attempts) {
  try {
    const c = await fetchHistoricalCandles(creds, idx.instrumentToken, "15minute", from, to, false, "Asia/Kolkata");
    console.log(label, "OK candles:", c.length, "last:", c.at(-1)?.timestamp);
  } catch (e) {
    console.log(label, "FAIL:", e instanceof Error ? e.message : e);
  }
}
