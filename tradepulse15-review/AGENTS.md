# Devin / AI coding-agent instructions

## Product goal
Build TradePulse Precision 15: a local Windows-hosted, approval-gated options signal assistant for long NIFTY and SENSEX options. It is not a broker, investment adviser, or profit-guarantee system.

## Non-negotiable safety rules
- Default to PAPER mode. `LIVE_ORDER_PLACEMENT_ENABLED` must default to `false` in code and examples.
- Never place an order merely because a signal was generated or Telegram was sent. A human must explicitly approve that exact, unexpired signal in the local dashboard.
- Never bypass the capital/risk, daily-loss, max-trades, max-open-position, market-hours, stale-data, option-liquidity, spread, price-drift, duplicate-order, or exchange-segment checks.
- Do not implement market orders. Use bounded LIMIT orders only; revalidate quote and spread immediately before submission.
- Reconcile broker order status and fills after submission. An order API acknowledgement is not proof of execution.
- No order retry unless the first request is proven not to have reached the broker. Treat ambiguous network errors as `UNKNOWN`; reconcile first to prevent duplicate orders.
- Bind the server to `127.0.0.1` by default. Never expose the dashboard or approval endpoint to the public internet without a separate security design.
- Keep API secrets, access tokens, Telegram token, and client data out of source control, logs, browser code, screenshots, and error responses.
- Live order placement must remain disabled until static-IP whitelisting and current Zerodha/exchange requirements are explicitly verified by the user. Do not infer compliance from an OPS threshold.
- The application must not claim signals are accurate or profitable. Score is a rule-confluence score, not a probability.

## Strategy requirements
- Instruments: NIFTY (NSE/NFO) and SENSEX (BSE/BFO) only in the default profile. No BANKNIFTY by default.
- Entry timeframe: completed 15-minute candles. Higher-timeframe filter: completed 1-hour candles.
- Underlying spot index is the directional reference. Use matching index-futures data for VWAP and volume; do not calculate ordinary traded-volume VWAP from a spot index that has no traded volume.
- Signals mean BUY_CALL or BUY_PUT (long options only). Never label a BUY_PUT as a short option sale.
- Require aligned 1-hour trend, 15-minute EMA structure, VWAP, Supertrend, ADX/DI, MACD histogram, RSI range, futures volume, and a confirmed price-action trigger.
- Initial signal score threshold is 85/100, with hard gates. A score is not a calibrated probability.
- At most two actionable recommendations per trading day across BOTH indices combined; at most one open recommendation/position at a time. Zero trades is valid.
- Do not force a trade to meet the daily quota. Deduplicate by underlying + strategy + completed candle timestamp.
- Avoid new entries before 09:45 and after 14:30 IST by default. Flatten/exit policy must be configurable and tested against the exchange session calendar.

## Architecture expectations
- Keep domain, strategy, broker, notification, API, and dashboard layers separated.
- Make indicators and strategy functions pure and unit-testable.
- Implement a MarketDataProvider and OrderGateway interface; the Kite adapter must be isolated behind these ports.
- Fetch the instrument master dynamically and resolve exchange, segment, expiry, strike, tick size, lot size, and instrument token from current data. Never hardcode tokens or lot sizes.
- Implement Telegram as notifications only initially. Do not treat Telegram delivery as an approval unless a separately designed authenticated callback is implemented.
- Local dashboard approval is the only approval mechanism in the first release.
- Use server-side validation for all approvals. Approval token must be one-time, tied to exact signal/contract/quantity/limit price, and expire quickly. Recheck signal age, live quote, spread, funds, daily loss, positions, and all risk constraints immediately before order placement.
- Persist signals, approvals, order intents, broker order IDs, fills, and daily risk state. Prefer SQLite for the local single-user deployment.
- Include audit logs with secrets redacted.

## Delivery workflow
1. Inspect this specification and existing scaffold before coding.
2. Implement market data and auth with secure token handling.
3. Implement indicators/strategy with unit tests and deterministic fixtures.
4. Implement option selection and capital/risk validation.
5. Implement dashboard and Telegram notifications.
6. Implement approval-gated broker order flow, initially with a mock broker only.
7. Add Kite live adapter behind feature flags and document exact setup requirements.
8. Add integration tests, paper-trading mode, error recovery, and Windows scripts.
9. Do not switch live placement on by default. Provide a separate go-live checklist and require the user's explicit action.

## Definition of done
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- Tests prove that no order is sent without explicit approval, approvals expire, duplicate signals/orders are blocked, one-lot affordability is checked, daily caps apply across both indices, and stale/partial candles cannot trigger entries.
- Dashboard shows why a signal qualified or was rejected, the exact contract, estimated charges/slippage, risk in INR, entry/stop/target, data timestamps, and a clear paper/live status.
- Any live API limitation or unimplemented provider is visibly labelled; no simulated data is ever presented as live.
