# TradePulse Precision 15

A local Windows-hosted, market-data and signal assistant for **NIFTY and SENSEX long options**. It evaluates completed 15-minute entry candles against a completed 1-hour trend filter, then displays a contract-specific recommendation. This build is **manual-execution only**: the dashboard does not submit approvals or broker orders.

> **Safety:** This is a software scaffold, not a profitable strategy or investment advice. A score is a confluence score, not a probability of winning. Default mode is PAPER and live order placement is disabled. Do not trade real money until data, option-premium backtests, paper trading, operational controls, and current broker/exchange requirements have been independently checked.

## User profile

| Setting | Value |
|---|---|
| Host | Windows PC |
| Indices | NIFTY (NSE/NFO), SENSEX (BSE/BFO) |
| Instrument | Long CE / long PE only |
| Signal timeframe | 15 minutes |
| Trend timeframe | 1 hour |
| Execution | Signal-only; manual order placement in Kite |
| Alerts | Telegram + dashboard |
| Capital | Below ₹1,00,000; exact amount configured by user |
| Risk per trade | 0.5% of configured capital |
| Daily loss limit | 1.5% of configured capital |
| Daily entries | Maximum 2 across both indices combined |
| Concurrent positions | Maximum 1 |

## Current scaffold status

This is an improved Devin handoff project with a functioning signal-generation path, REST historical-candle retrieval from Kite, dynamic instrument-master resolution, option quote filtering, Telegram notifications, a local dashboard, and persisted signals. The strategy is deterministic for injected evaluation times and rejects incomplete, invalid, stale, future-dated, or mismatched candle snapshots. Risk-budget and capital-notional checks are fail-closed. The daily loss gate uses realized P&L that the operator manually records when closing a traded recommendation; it does not read broker P&L or track unrealized drawdown. The Kite order adapter, complete approval-to-order workflow, broker funds/positions validation, fill reconciliation, exchange holiday calendar, WebSocket stream, and historical option-premium backtest are still incomplete. **No live broker order can be sent by this build, even if LIVE environment flags are changed.**

## Quick start on Windows

1. Install Node.js 20.11+ (LTS recommended).
2. Extract the project or clone its GitHub repository.
3. Open PowerShell in the project folder.
4. Run:

   ```powershell
   Copy-Item .env.example .env
   npm install
   ```

5. Edit `.env`. Set `TRADING_CAPITAL_INR` to your actual capital (must be greater than 0 and below ₹1,00,000). Keep `TRADING_MODE=PAPER` and `LIVE_ORDER_PLACEMENT_ENABLED=false`.
6. Start the local dashboard:

   ```powershell
   npm run dev
   ```

7. Open `http://127.0.0.1:3100`.

Without Kite credentials, the dashboard shows setup and data status. With valid credentials, the engine polls historical candles and generates eligible recommendations. Set an accurate capital amount; a zero, missing, or ₹1,00,000-and-above value disables actionable recommendations.

## Telegram setup

Follow [`docs/TELEGRAM_SETUP.md`](docs/TELEGRAM_SETUP.md). In summary: create a bot with `@BotFather`, open it and send `/start` plus a test message, set `TELEGRAM_ENABLED=true` and `TELEGRAM_BOT_TOKEN` in `.env`, run `npm run telegram:setup` to discover the private chat ID, set `TELEGRAM_CHAT_ID`, then run `npm run telegram:test`.

Telegram is not an order-approval channel. It sends alerts and can optionally exchange a Kite request token for the daily access token from the configured private chat. No Telegram message can authorize or submit an order. The dashboard currently supports dismissing an untraded recommendation or recording realized P&L after a manually executed trade; it does not place the trade.

## Kite Connect setup

1. Have an active Zerodha account with the required derivatives segment permissions.
2. Create a Kite Connect app and configure its redirect URL to match `KITE_REDIRECT_URL`.
3. Put API key and API secret into the local `.env` only. The secret must remain server-side.
4. Use the implemented request-token/access-token exchange and daily Kite login flow. Do not assume an access token remains valid indefinitely.
5. Use the Kite Connect market-data access required for REST historical candles and quotes. A live WebSocket stream is not included in this build.
6. Resolve all NIFTY/SENSEX spot, futures and options contracts from the latest instrument master. Do not hardcode instrument tokens or lot sizes.
7. Before enabling any API order placement, verify the current static-IP whitelisting, retail-algo, broker, exchange, and order-type requirements directly with Zerodha and the exchanges. This project leaves live order placement disabled.

Official references:
- Kite Connect docs: https://kite.trade/docs/connect/v3/
- Kite Connect orders: https://kite.trade/docs/connect/v3/orders/
- Kite Connect developer portal: https://developers.kite.trade/
- Zerodha static IP guidance: https://support.zerodha.com/category/trading-and-markets/general-kite/kite-api/articles/static-ip

## How semi-automatic execution should work

The intended future semi-automatic workflow is described here, but is not implemented end-to-end. This build validates completed-candle data, evaluates the strategy, selects a liquid option from the current instrument master, performs configured capital/risk checks, and displays the recommendation with Telegram notification. The user must execute any trade manually in Kite. There is no broker approval button, order placement, order reconciliation, or automatic open-position P&L feed in this version.

## Operational limitations to understand

- The signal confluence score is not a probability of success and does not establish profitability.
- `TRADING_CAPITAL_INR` must be set below ₹1,00,000. The engine checks both stop-risk budget and the full premium notional for a long option lot.
- When a manually traded recommendation is closed, enter realized net P&L after charges in the dashboard. The daily loss guard is only as accurate as the P&L entered; unreported trades and unrealized losses are not visible to this build.
- The app uses a weekday/time window, not a verified exchange holiday calendar. Check exchange sessions yourself.
- Premium stop/target values use a configurable delta approximation. They are not validated against historical option-premium paths and are not guaranteed execution prices.
- Live order execution remains disabled in code. Do not interpret `TRADING_MODE=LIVE`, a static-IP setting, or any environment flag as permission or ability to place an order.

## Commands

```powershell
npm run typecheck
npm test
npm run build
npm run dev
npm start
npm run telegram:setup
npm run telegram:test
```

## Project files

- `AGENTS.md` — persistent instructions for Devin / coding agents.
- `DEVIN_TASK.md` — ordered implementation request and acceptance criteria.
- `docs/TRADING_RULES.md` — entry rules, score weights, risk and no-trade conditions.
- `docs/ARCHITECTURE.md` — target component architecture and event flow.
- `docs/KITE_SETUP.md` — broker integration and security requirements.
- `docs/WINDOWS_RUNBOOK.md` — Windows setup and operation.
- `docs/REVIEW_AND_NEXT_STEPS.md` — changes in this revision, verification notes and remaining limitations.
- `src/` — strategy, indicators, signal engine, Kite market-data client, persistence and incomplete broker/order interfaces.
- `public/` — local dashboard shell.
- `tests/` — deterministic strategy and risk tests.

## Import into Devin

Devin's documented onboarding flow uses a connected Git provider and a repository. Create a private GitHub repository, push this project, connect GitHub to Devin, add the repository, then start a session with the contents of `DEVIN_TASK.md`. Do not upload `.env`, access tokens, or API secrets.
