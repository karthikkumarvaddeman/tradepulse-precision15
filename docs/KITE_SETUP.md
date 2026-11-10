# Kite Connect implementation checklist

This is an implementation checklist, not legal or broker advice. Verify current Zerodha, NSE, BSE and SEBI requirements before live use.

## Credentials and login
- Create a Kite Connect app and set its redirect URL to the local backend callback.
- Keep `KITE_API_SECRET` server-side only. Do not send it to the browser, Telegram, source control, or logs.
- Implement the documented login/request-token/access-token handshake. Access-token lifecycle and daily re-authentication must be handled explicitly.
- Store tokens only in a protected local secret store or encrypted persistence; never commit them.

## Market data
- Use WebSocket for live ticks/quotes and REST historical candles where permitted by the subscription.
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
