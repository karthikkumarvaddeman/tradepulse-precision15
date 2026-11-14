# Windows operator runbook

## First-time setup
1. Install Node.js 20.11+ LTS.
2. Extract/clone repository to a local folder, e.g. `C:\Trading\tradepulse-precision15`.
3. Open PowerShell in that folder.
4. Run `Copy-Item .env.example .env` and edit `.env` with Notepad or VS Code.
5. Set actual capital below ₹1,00,000; `TRADING_CAPITAL_INR=0` disables actionable recommendations.
6. Keep PAPER mode and live orders disabled. Live order execution is not implemented in this build and cannot be enabled with environment flags.
7. Run `npm install`, `npm run typecheck`, `npm test`, `npm run build`.
8. Run `npm run dev` and open `http://127.0.0.1:3100`.

## Daily signal routine
1. Start app before market open.
2. Complete Kite login and confirm token/session status.
3. Confirm instrument master date and NIFTY/SENSEX spot, futures and option instruments are resolved.
4. Confirm the computer clock is synchronized and dashboard candle freshness/quote quality checks pass. This version uses REST historical candles; a WebSocket feed is not implemented.
5. Confirm Telegram delivery test and dashboard status.
6. Review each recommendation on dashboard. Telegram is informational only; this version has no approve/order button.
7. If you choose to trade, verify the exact contract, exchange, expiry, lot, limit price, spread, stop, target, charges estimate, and rupee risk directly in Kite, then place/manage the order yourself.
8. After closing the manually placed trade, use the dashboard close action and enter realized net P&L after charges. This is required for the app's daily realized-loss gate.
9. Independently monitor broker positions, open-trade drawdown, funds and order fills; this app does not ingest those values.

## Troubleshooting
- No signals: check hard gates, data feed, completed candle status and signal score; do not loosen rules just to create trades.
- No option contract: check instrument master refresh, exchange segment (NFO/BFO), expiry, quote freshness and lot affordability.
- Telegram not working: test token/chat ID and network; dashboard remains the source of truth.
- Kite auth expired: redo official login; do not reuse stale access tokens.
- Daily loss status depends on the realized P&L you enter. It does not include unreported or unrealized losses.
- Order submission and reconciliation are not implemented in this version; manage trades directly in Kite.
