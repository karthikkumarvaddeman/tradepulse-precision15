# Target architecture

```text
Kite Connect (REST + WebSocket)
          |
          v
Market Data Adapter ---- Instrument Master Cache
          |                       |
          v                       v
Candle Builder + Validator     Option Contract Resolver
          |                       |
          v                       |
Indicators (pure functions)       |
          |                       |
          v                       |
1H Regime Filter + 15m Precision Strategy
          |                       |
          v                       |
Daily Signal Limiter + Risk Engine
          |                       |
          v                       |
Option Selector <-----------------+
          |
          v
Signal Store ---> Dashboard + Telegram Notification
          |
          v
One-time approval in localhost dashboard
          |
          v
Revalidation (quote, risk, funds, limits, freshness)
          |
          v
Order Gateway (Mock/Paper by default; Kite only after go-live gate)
          |
          v
Order/Trade reconciliation + Audit Log
```

## Ports/adapters
- `MarketDataProvider`: spot/futures candles, quotes, market depth, instruments, funds and positions.
- `OptionContractResolver`: resolve contracts from current exchange instrument master.
- `OrderGateway`: submit bounded LIMIT order, get order history, get trades, cancel pending order.
- `NotificationProvider`: Telegram only sends alert; never acts as approval.
- `SignalRepository`: persist signals, daily caps, approvals, order intents and reconciliation state.

## Reliability requirements
- Candle timestamps are exchange-local and normalized internally to ISO UTC plus Asia/Kolkata display.
- Build 1-hour candles only from completed 15-minute bars, or verify provider's hourly bars against the same session boundaries.
- Persist enough raw market snapshots for replay/backtesting; clearly distinguish collected data from reconstructed data.
- Use idempotency keys on signal and approval/order intent records.
- On order submit timeout, mark UNKNOWN and reconcile against broker order book before any retry.
- Dashboard and API listen on 127.0.0.1 by default.
