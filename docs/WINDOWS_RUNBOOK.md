# Windows operator runbook

## First-time setup
1. Install Node.js 20.11+ LTS.
2. Extract/clone repository to a local folder, e.g. `C:\Trading\tradepulse-precision15`.
3. Open PowerShell in that folder.
4. Run `Copy-Item .env.example .env` and edit `.env` with Notepad or VS Code.
5. Set actual capital; do not leave `TRADING_CAPITAL_INR=0` when you expect actionable signals.
6. Keep PAPER mode and live orders disabled.
7. Run `npm install`, `npm run typecheck`, `npm test`, `npm run build`.
8. Run `npm run dev` and open `http://127.0.0.1:3100`.

## Daily routine (after Devin implements provider)
1. Start app before market open.
2. Complete Kite login and confirm token/session status.
3. Confirm instrument master date and NIFTY/SENSEX futures/options are resolved.
4. Confirm WebSocket connected, clock synchronized, candle completeness and quote freshness.
5. Confirm Telegram delivery test and dashboard status.
6. Review each signal on dashboard. Telegram is informational only.
7. Before approval, inspect the exact contract, exchange, expiry, lot, limit price, spread, stop, target, charges estimate, and rupee risk.
8. Confirm no other open position and daily limits are intact.
9. Reconcile orders/fills throughout the session; never assume an order was filled.
10. Stop new entries after the configured cutoff and complete end-of-day reconciliation.

## Troubleshooting
- No signals: check hard gates, data feed, completed candle status and signal score; do not loosen rules just to create trades.
- No option contract: check instrument master refresh, exchange segment (NFO/BFO), expiry, quote freshness and lot affordability.
- Telegram not working: test token/chat ID and network; dashboard remains the source of truth.
- Kite auth expired: redo official login; do not reuse stale access tokens.
- Unknown order status: reconcile in Kite order book before any action; never retry blindly.
