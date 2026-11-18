import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.enum(["127.0.0.1", "localhost", "::1"]).default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3100),
  TRADING_CAPITAL_INR: z.coerce.number().nonnegative().default(0),
  MAX_CAPITAL_INR: z.coerce.number().positive().max(100000).default(100000),
  RISK_PER_TRADE_PERCENT: z.coerce.number().positive().max(1).default(0.5),
  MAX_DAILY_LOSS_PERCENT: z.coerce.number().positive().max(5).default(1.5),
  MAX_TRADES_PER_DAY: z.coerce.number().int().min(1).max(2).default(2),
  MIN_SIGNAL_SCORE: z.coerce.number().min(0).max(100).default(85),
  TRADING_MODE: z.enum(["PAPER", "LIVE"]).default("PAPER"),
  STRATEGY_MODE: z.enum(["precision15", "vwap", "gapfade", "combo", "combo-late", "combo-regime"]).default("combo"),
  WATCHLIST_ENABLED: z.string().default("false"),
  WATCHLIST_STOCKS: z.string().default("RELIANCE,TCS,HDFCBANK,ICICIBANK,SBIN,INFY,LT,AXISBANK,KOTAKBANK,BAJFINANCE,MARUTI,SUNPHARMA"),
  LIVE_ORDER_PLACEMENT_ENABLED: z.string().default("false"),
  KITE_STATIC_IP_CONFIRMED: z.string().default("false"),
  LIVE_ORDER_CONFIRMATION_PHRASE: z.string().optional(),
  KITE_API_KEY: z.string().optional(),
  KITE_API_SECRET: z.string().optional(),
  KITE_ACCESS_TOKEN: z.string().optional(),
  KITE_REDIRECT_URL: z.string().optional(),
  APP_TIMEZONE: z.string().default("Asia/Kolkata"),
  MAX_OPEN_RECOMMENDATIONS: z.coerce.number().int().min(1).max(2).default(1),
  STOP_ATR_MULTIPLE: z.coerce.number().positive().default(1.5),
  TARGET_R_MULTIPLE: z.coerce.number().positive().default(1.5),
  OPTION_DELTA_APPROX: z.coerce.number().min(0.05).max(1).default(0.5),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_ENABLED: z.enum(["true", "false"]).default("false"),
  APP_LOCAL_ACCESS_TOKEN: z.string().min(16).default("change-this-to-a-long-random-value"),
});

export const env = schema.parse(process.env);
// Fail-closed: this repository has no implemented order-submit/reconciliation
// workflow. Environment flags alone can never enable live broker orders.
export const isLiveOrderEnabled = false;
export const capitalConfigured = env.TRADING_CAPITAL_INR > 0 && env.TRADING_CAPITAL_INR < env.MAX_CAPITAL_INR;
export const kiteConfigured = () => Boolean(env.KITE_API_KEY && env.KITE_ACCESS_TOKEN);
export const kiteSecretConfigured = () => Boolean(env.KITE_API_KEY && env.KITE_API_SECRET);
