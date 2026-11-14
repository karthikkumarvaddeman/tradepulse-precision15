# TradePulse Precision 15 — review and implementation status

This document records the changes made during the project review and the work that remains before any semi-automatic or live-trading workflow can be considered.

## Improvements in this revision

- Strategy evaluation uses an injected clock and checks completed, chronologically ordered, valid OHLC candles plus data freshness and future timestamps.
- Indicator snapshots must match the latest completed spot candles by timestamp and close. A failed hard gate returns `HOLD`; a confluence score is not a probability.
- RSI returns 50 for a completely flat series; ATR uses Wilder smoothing; OHLC, timestamp, and volume validation rejects malformed candles.
- Futures volume baselines exclude the current candle, and same-time-slot baselines use prior sessions only.
- Instrument CSV parsing supports quoted fields and escaped quotes. Option expiry selection uses the nearest listed CE/PE expiry, independently of the futures expiry, so a weekly option is not skipped just because its future expires later.
- Option quotes without a valid exchange timestamp are rejected. Kite timestamps are normalized as IST when the API supplies a timezone-less value.
- The recommendation path requires an explicitly configured capital amount below the configured cap, enforces stop-risk sizing and full long-option premium notional affordability, and uses the configured daily recommendation cap.
- Daily realized P&L can be recorded in the dashboard when a manually placed trade is closed. The ledger is persisted locally and the daily loss gate blocks further recommendations after the entered realized loss reaches the configured limit.
- Signal-store read/write failures fail closed rather than silently resetting risk history. Local files are written with restrictive permissions where the operating system supports them.
- Poll cycles and NIFTY/SENSEX evaluation are serialized to avoid overlapping cycles creating more than one active recommendation during parallel quote requests.
- The dashboard distinguishes signal-only operation, expired recommendations, dismissals, and manually recorded close P&L. The server binds only to loopback addresses.
- The sample Kite redirect URL now matches the implemented `/callback` route.
- Live order placement is hard-disabled in code. Changing `.env` flags cannot turn it on.

## Current limitations — do not treat as live-ready

- This is a **market-data and signal assistant**, not an automated or semi-automated order system. Orders must be entered and managed manually in Kite.
- The Kite order adapter, approval-to-order workflow, broker funds/positions validation, order status reconciliation, partial-fill handling, and unknown-submit recovery are not implemented end-to-end.
- The daily loss limit only uses net realized P&L manually entered by the operator. It cannot see unreported trades, open positions, broker P&L, or unrealized drawdown. A manually recorded ledger is not a substitute for broker-side risk controls.
- Persistence is a local JSON store rather than a transactional database. It is not designed for multi-process use or power-loss-safe financial accounting.
- Market data is polled from REST historical candles and quote snapshots. There is no WebSocket live tick stream.
- The market clock checks weekdays and times but does not incorporate an official exchange holiday/session calendar.
- Premium stop/target values use a delta approximation. There is no verified option-Greeks feed or historical option-premium path validation.
- No reliable historical option-premium backtest or paper-trading results are included. A high score does not imply a profitable trade.

## Next implementation work

1. Build and test a mock-only approval flow tied to a single-use, expiring signal, exact contract, quantity, and max limit price.
2. Implement a Kite order gateway behind a separate feature gate only after mock flow, funds/position validation, current broker/exchange compliance checks, and idempotent order reconciliation pass.
3. Replace manual P&L entry with reconciled broker fills and open-position exposure; include unrealized daily drawdown in the risk gate.
4. Move state to transactional persistence with migrations and recovery tests.
5. Add official exchange calendars and live market-data handling with explicit stale-feed behavior.
6. Build an option-premium backtest from timestamped historical option data, including realistic spreads, slippage, charges, expiry behavior, and out-of-sample periods; then paper trade before considering live use.

## Verification performed for this revision

- Strict TypeScript compilation of all `src/` and `tests/` files was run with temporary local declaration shims because the package dependencies could not be installed in the build environment.
- Compiled source modules passed targeted runtime smoke checks for strategy gates/freshness, indicator/OHLC handling, risk sizing, daily recommendation limits, realized P&L persistence, option expiry selection, option quote filtering, and Kite timestamp normalization.
- The repository's normal `npm run typecheck`, `npm test`, and `npm run build` commands still need to be run on a machine with npm registry access and the actual package dependencies installed. The shim-based compile is useful, but is not a substitute for those commands.
