# Kite Connect setup

This app uses Kite Connect for **market data only**. It never places orders — you execute manually.

## Daily login (required every trading day)
Kite access tokens expire daily. Two options:

**Via Telegram (easiest when away from the PC):**
1. Open `npm run kite:login` output URL on any device and log in.
2. After Zerodha redirects, copy the `request_token` value from the redirect URL.
3. Send that token as a message to your Telegram bot — the app exchanges it, saves `KITE_ACCESS_TOKEN` to `.env`, and confirms on Telegram. Only messages from your configured `TELEGRAM_CHAT_ID` are accepted.
4. Send `/status` to the bot anytime for a signal/data summary.

**Via terminal:**
1. `npm run kite:login` — prints a Zerodha login URL.
2. Open the URL, log in, and approve the app.
3. Zerodha redirects to `KITE_REDIRECT_URL` with a `request_token` query parameter.
4. `npm run kite:token -- <request_token>` — exchanges it for an access token.
5. Copy the printed `KITE_ACCESS_TOKEN=...` into `.env` and restart the app (`npm run dev`).

``KITE_API_KEY`, `KITE_API_SECRET`, and `KITE_REDIRECT_URL` are set once in `.env`. Register the exact callback URL `http://127.0.0.1:3100/callback` in the Kite developer console (or keep the `.env` value and server route in sync). The API secret stays server-side only.

## What the app does with Kite
- Downloads the NSE/BSE index master and NFO/BFO derivatives master (cached ~6h).
- Resolves the NIFTY 50 / SENSEX index token and the nearest-expiry index futures contract dynamically — no hardcoded tokens.
- Fetches completed 15-minute and 60-minute candles for spot, and 15-minute futures candles (for session VWAP and volume confirmation).
- Fetches option-chain quotes only when a signal qualifies, to pick a liquid contract (spread, quote age, volume, OI checks).
- Uses REST historical-candle polling; a live WebSocket market-data stream is not implemented in this build.

## Credentials and login
- Create a Kite Connect app and set its redirect URL to the local backend callback.
- Keep `KITE_API_SECRET` server-side only. Do not send it to the browser, Telegram, source control, or logs.
- The request-token/access-token exchange and daily login helper are implemented. Access tokens expire daily; repeat the login flow each trading day.
- Store tokens only in a protected local secret store or encrypted persistence; never commit them.

## Market data
- A future enhancement is WebSocket live ticks/quotes; this version relies on REST historical candles and quote snapshots.
- Download and refresh the instrument master; map NIFTY options to NSE/NFO and SENSEX options to BSE/BFO using official instrument rows.
- Resolve spot, futures, and option symbols dynamically. Verify exchange, segment, instrument token, expiry, strike, option type, lot size, tick size and tradability.
- Use the matching index futures contract for futures VWAP and volume confirmation.
- Store timestamps, last update time, source and quote age. Stale/missing values fail closed.

## Order placement (disabled by default)
- User must confirm their current broker/exchange setup, applicable retail-algo requirements and static-IP whitelisting before enabling API orders.
- A fixed local ISP public IP may not be available on a typical home broadband plan. Confirm with the ISP and Kite developer console; do not assume a dynamic IP is acceptable.
- Restrict order types to bounded LIMIT orders. Do not implement unprotected market orders.
- Approval must be local dashboard action and bind to signal ID, contract, quantity, max price, risk estimate and expiry. Show a final confirmation dialog with those details.
- Immediately before submit: refresh quote, validate price drift, spread, market status, available margin, current positions, daily risk and signal age.
- Persist broker order ID; poll/postback/reconcile order state and fills. Do not treat placement ACK as filled.
- Handle partial fills, rejection, pending/cancelled orders, disconnects and unknown submit outcomes.
- Ensure static-IP, tagging/registration, OPS limits and other controls match the then-current broker and exchange implementation. Never infer legal readiness from this README.

## No sandbox assumption
Do not assume a live broker sandbox exists. Use a local `MockOrderGateway` for tests and paper trading; it must be impossible for mock mode to submit live orders.
