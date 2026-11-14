import { env } from "../src/config/env.js";

// Sends a clearly-labeled SAMPLE signal in the exact format the engine uses,
// so the user can preview Monday's Telegram alerts. No real trade implied.
const token = env.TELEGRAM_BOT_TOKEN;
const chatId = env.TELEGRAM_CHAT_ID;
if (!token || !chatId) throw new Error("Telegram not configured");

const text = [
  "📋 SAMPLE SIGNAL — format preview only, no action",
  "",
  "TradePulse BUY_CALL — NIFTY [vwap]",
  "Score 0/100 (confluence, not a probability) | Regime: UNCLEAR",
  "Contract: NFO:NIFTY26NOV23500CE strike 23500 exp 2026-11-17",
  "Bid 118.00 / Ask 122.00 / LTP 120.00 | Qty 75",
  "Entry limit ~122.00 | Premium stop ~102.00 | Target ~152.00",
  "Underlying NIFTY: stop 25380.50 | target 25720.25",
  "Est. risk ~₹1,650 | Candle 2026-11-16T09:45:00+05:30",
  "Valid until ~10:15 IST — place orders manually. Dashboard: http://127.0.0.1:3100",
].join("\n");

const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ chat_id: chatId, text }),
});
const body = await res.json();
console.log(res.ok ? "Sample signal sent to Telegram" : `Failed: ${JSON.stringify(body)}`);
