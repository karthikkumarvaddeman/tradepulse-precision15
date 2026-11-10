# Devin task: Build TradePulse Precision 15

You are working in a new TypeScript repository. Implement the product described in `README.md`, `AGENTS.md`, and `docs/`.

## User configuration
- Host: user's Windows PC.
- Instruments: NIFTY and SENSEX options only (NSE/NFO and BSE/BFO).
- Trading style: intraday, 15-minute entries, 1-hour trend confirmation.
- Execution: semi-automatic. Display a recommendation, ask the user to approve it, then (only if live mode is fully configured and explicitly enabled) submit that exact order through Kite. No unattended entry.
- Alerts: Telegram plus local dashboard.
- Capital: below INR 100,000. Exact capital must be entered by the user in `.env`; do not assume ₹80,000 or another value.
- Risk defaults: 0.5% of entered capital per trade, 1.5% daily stop, max two entries per day total across both indices, max one open position/recommendation.

## First tasks
1. Inspect the scaffold and report a short implementation plan.
2. Finish typed indicator implementations (EMA, RSI, ATR, MACD, ADX/DI, Supertrend, Bollinger, rolling mean/volume ratio, VWAP).
3. Implement the rule engine in `src/strategy/precisionStrategy.ts` using only completed candles and strict hard-gate logic from `docs/TRADING_RULES.md`.
4. Add a proper instrument-master cache/resolver for NFO and BFO, plus an option selector. No hardcoded lot sizes, instrument tokens, strikes, or expiry dates.
5. Add Kite authentication and market data adapters using current official Kite Connect docs. Do not put API secret/access token in frontend.
6. Add Telegram alerting; use the existing Bot API notifier and configuration. Messages must state signal score is not a probability and include timestamp, expiry, contract, quote age, risk estimate and a dashboard URL. Telegram is notification-only in the first release; keep approval in the local dashboard unless the user explicitly requests and separately reviews a secure Telegram callback design.
7. Build a dashboard with separate NIFTY/SENSEX panels, signal history, indicator votes, risk details, approval/decline actions, and order status.
8. Add the approval workflow and mock order gateway. Each approval must expire, be single-use, and bind to the exact contract, quantity and maximum limit price. Revalidate all risk/market gates before order submission.
9. Add Kite order adapter behind `LIVE_ORDER_PLACEMENT_ENABLED=false` by default. Include static-IP check and document broker/exchange compliance checks. Never use unprotected market orders.
10. Add persistence, audit logging, Windows start/stop scripts, tests, and operator runbook.

## Acceptance criteria
- Running in default PAPER mode does not connect to live order placement and cannot send any real order.
- Signal generation is deterministic for fixed candle fixtures.
- A high score without all mandatory conditions returns HOLD.
- More than two daily signals across NIFTY + SENSEX is blocked.
- If a single lot exceeds risk allowance, signal is marked `SKIPPED_RISK_BUDGET` and no order can be approved.
- Telegram notifications never place orders.
- Approve button is explicit and shows exact contract, side, qty, limit price, stop, target, risk, charges and warning before final confirmation.
- Network timeout after submit creates UNKNOWN order state and triggers broker reconciliation; it must never blindly retry.
- Dashboard is reachable on localhost only by default.
- All tests pass and documentation explains that signals are not guaranteed accurate/profitable.

Do not claim that the system is live-ready until all acceptance criteria, historical option backtests, paper trading, and the user's broker/regulatory checks are complete.
