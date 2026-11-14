---
name: tradepulse-backtest
description: Run and extend the TradePulse NIFTY/SENSEX signal backtests — evaluate strategy variants over historical Kite candle data, add new entry rules, and interpret results. Use when asked to backtest, compare, or improve trading signals in this repo.
---

# TradePulse backtesting workflow

## What this repo is
Local signal assistant for NIFTY/SENSEX options. User executes orders manually on Kite; the app never places orders. Live mode = `STRATEGY_MODE` in `.env` (`combo` | `gapfade` | `vwap` | `precision15`).

## Safety rules (non-negotiable)
- Never claim signals are accurate/profitable; score is confluence, not probability
- Never place orders; signals are notification-only
- `.env` holds secrets — never print or commit it
- Server binds 127.0.0.1 only

## Key files
- `scripts/strategy-sweep.ts` — multi-strategy backtest over ~180 days; prints per-trade log. Run: `npx tsx scripts/strategy-sweep.ts 180`
- `scripts/backtest-range.ts` — precision15 gate evaluation over a range
- `scripts/backtest-day.ts` — single-day replay
- `scripts/market-analysis.ts` — statistical market-behavior tests (autocorrelation, VWAP follow-through, gap fills)
- `src/strategy/altStrategies.ts` — live alt entry rules (vwap/gapfade/combo)
- `src/strategy/precisionStrategy.ts` — deprecated 10-gate confluence (no edge found)
- `src/application/signalEngine.ts` — live engine; `STRATEGY_MODE` branch builds signals

## How to add/test a new strategy
1. Add a pure function `(dayCandles, prevDayClose, sessionVwap, evalIdx) => "BUY_CALL"|"BUY_PUT"|null` in the sweep's STRATEGIES list (or altStrategies.ts for live use)
2. Entry rules evaluate on the last completed 15m candle of each IST day, inside 09:45–14:30 window
3. Exits in sweep: `simulateOutcome` (1.5×ATR stop, 1.5R target, EOD square-off) or `simulateOutcomePx` (custom target, e.g. gap-fill = prevDayClose)
4. Run `npx tsx scripts/strategy-sweep.ts 180` — compare signals/W/L/pts vs existing rows before touching live code
5. Only promote to live via `altStrategies.ts` + `STRATEGY_MODE` after it beats baseline

## Interpreting results
- pts = underlying index points, NOT option premium (delta ~0.5, minus theta/spread)
- <30 trades = noise; require consistent edge across regimes before trusting
- Conservative sim: candle spanning both stop+target counts as LOSS
- Known-good baseline (248 days): combo = gapfade(>0.4% gap, target prev close) on gap days + VWAP-reclaim otherwise → 57 trades, +3549 pts. VWAP-only +1386/27, gapfade-only +3029/36, precision15 −486/~8
- Tested-and-rejected: ORB (−1622), volume filters (−494), trend filters (+906 < +1386), MACD/RSI gate loosening

## Live ops
- Daily Kite token required: Telegram request_token flow or /callback page
- Telegram `/status` for health; signals only on qualifying candles
- `npm run typecheck && npm test && npm run build` must pass before committing
