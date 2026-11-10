# TradePulse Precision 15

A local Windows-hosted, semi-automatic signal assistant for **NIFTY and SENSEX long options**. It uses a completed 15-minute entry candle with a completed 1-hour trend filter, then displays a contract-specific recommendation for human approval. Telegram is used for alerts; approval happens in the local dashboard.

> **Safety:** This is a software scaffold, not a profitable strategy or investment advice. A score is a confluence score, not a probability of winning. Default mode is PAPER and live order placement is disabled. Do not trade real money until data, option-premium backtests, paper trading, operational controls, and current broker/exchange requirements have been independently checked.

## User profile

| Setting | Value |
|---|---|
| Host | Windows PC |
| Indices | NIFTY (NSE/NFO), SENSEX (BSE/BFO) |
| Instrument | Long CE / long PE only |
| Signal timeframe | 15 minutes |
| Trend timeframe | 1 hour |
| Execution | Semi-automatic; explicit dashboard approval |
| Alerts | Telegram + dashboard |
| Capital | Below ₹1,00,000; exact amount configured by user |
| Risk per trade | 0.5% of configured capital |
| Daily loss limit | 1.5% of configured capital |
| Daily entries | Maximum 2 across both indices combined |
| Concurrent positions | Maximum 1 |

## Current scaffold status

This repository is a clean Devin handoff project. It contains the domain model, strategy rules, risk and option-selection interfaces, API/dashboard shell, environment template, implementation backlog and safety requirements. The live Kite market-data and order adapters are intentionally not complete in the starter scaffold. Devin should implement them against the current official Kite Connect documentation and tests. No live order can be sent by this scaffold.

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

The scaffold currently shows a setup/status screen rather than real-time signals until Devin implements and configures the Kite market-data provider.

## Telegram setup

Follow [`docs/TELEGRAM_SETUP.md`](docs/TELEGRAM_SETUP.md). In summary: create a bot with `@BotFather`, open it and send `/start` plus a test message, set `TELEGRAM_ENABLED=true` and `TELEGRAM_BOT_TOKEN` in `.env`, run `npm run telegram:setup` to discover the private chat ID, set `TELEGRAM_CHAT_ID`, then run `npm run telegram:test`.

Telegram is notification-only in this starter. The local dashboard remains the approval surface; Telegram messages do not authorize or submit orders.

## Kite Connect setup

1. Have an active Zerodha account with the required derivatives segment permissions.
2. Create a Kite Connect app and configure its redirect URL to match `KITE_REDIRECT_URL`.
3. Put API key and API secret into the local `.env` only. The secret must remain server-side.
4. Implement the daily Kite login/access-token flow. Do not assume an access token remains valid indefinitely.
5. Use the paid market-data plan if required for live WebSocket and historical candle data.
6. Resolve all NIFTY/SENSEX spot, futures and options contracts from the latest instrument master. Do not hardcode instrument tokens or lot sizes.
7. Before enabling any API order placement, verify the current static-IP whitelisting, retail-algo, broker, exchange, and order-type requirements directly with Zerodha and the exchanges. This project leaves live order placement disabled.

Official references:
- Kite Connect docs: https://kite.trade/docs/connect/v3/
- Kite Connect orders: https://kite.trade/docs/connect/v3/orders/
- Kite Connect developer portal: https://developers.kite.trade/
- Zerodha static IP guidance: https://support.zerodha.com/category/trading-and-markets/general-kite/kite-api/articles/static-ip

## How semi-automatic execution should work

1. Completed candle data is validated.
2. The 1-hour trend and 15-minute setup are evaluated.
3. A qualifying signal is matched to a liquid CE/PE option contract.
4. Risk is calculated using actual premium stop distance, lot size, costs and slippage assumptions.
5. Dashboard and Telegram show the opportunity and the reasons.
6. User opens the local dashboard and reviews the exact contract, quantity, price cap, stop, target and INR risk.
7. User explicitly approves that exact recommendation. Server rechecks signal expiry, quote freshness, price drift, funds, positions and all limits.
8. Only if live mode is explicitly enabled and every precondition passes may the Kite order adapter submit a bounded LIMIT order. Otherwise the system records a paper/blocked action.
9. Broker order status and actual fills must be reconciled; an API acknowledgement is not a fill.

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
- `src/` — typed starter code and adapters to be completed.
- `public/` — local dashboard shell.
- `tests/` — deterministic strategy and risk tests.

## Import into Devin

Devin's documented onboarding flow uses a connected Git provider and a repository. Create a private GitHub repository, push this project, connect GitHub to Devin, add the repository, then start a session with the contents of `DEVIN_TASK.md`. Do not upload `.env`, access tokens, or API secrets.
