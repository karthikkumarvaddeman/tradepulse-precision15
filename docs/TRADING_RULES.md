# Precision 15 trading rules (initial hypothesis; validate before use)

## Instruments and timeframes
- NIFTY spot is the directional reference for NIFTY options; SENSEX spot is the directional reference for SENSEX options.
- Use 1-hour completed candles for regime/trend context and 15-minute completed candles for entry setup.
- Use corresponding index futures for tradable volume and session VWAP. A spot index is not an ordinary traded security and must not be assigned fabricated volume.
- Default product is long options only: bullish = BUY_CALL (CE); bearish = BUY_PUT (PE).

## Hard gates (all required)
1. Candle data is complete, chronological, valid, and recent. No partial 15-minute candle.
2. A completed 1-hour candle confirms direction: EMA20 > EMA50 and close > EMA200 for calls; inverse for puts.
3. Completed 15-minute candle confirms the same EMA20/EMA50 alignment and price relative to EMA200.
4. Spot direction agrees with matching futures session VWAP.
5. Supertrend direction agrees.
6. ADX(14) >= 22 and +DI > -DI for calls; ADX >= 22 and -DI > +DI for puts.
7. MACD(12,26,9) histogram is positive and rising for calls; negative and falling for puts. Require two completed histogram values for slope comparison.
8. RSI(14) is 55–68 for calls or 32–45 for puts. Treat out-of-range as a rejection, not a counter-signal.
9. Matching futures volume is at least 1.2x the average for the same time-of-day slot across prior sessions (falls back to the 20-candle SMA only when slot history is insufficient). Missing futures volume means no trade.
10. A completed 15-minute price-action trigger exists: pullback continuation with close through prior candle high/low, or a breakout/breakdown and retest of a precomputed level. Avoid chasing an extended candle.
11. Option quote is current, spread passes configured limit, contract is valid for the exchange/expiry, and lot is affordable within risk budget.
12. No daily cap, open-position, market-hours, duplicate-signal, or daily-loss restriction is breached.

## Score (100 points)
The engine reports a diagnostic confluence score for strategy gates even when a specific hard gate fails; a high diagnostic score never overrides a failed gate. A directional action is returned only when all directional gates pass and the score meets the configured threshold. Score is confluence, not win probability.
- 1-hour trend alignment: 15
- 15-minute EMA structure: 15
- futures VWAP alignment: 15
- Supertrend direction: 10
- ADX and DI: 10
- MACD histogram direction/slope: 10
- RSI location: 5
- futures volume ratio: 10
- price-action trigger quality: 10

Minimum actionable score: 85/100. Max two actionable signals per day across NIFTY and SENSEX combined. No quota forcing; zero signals is valid. A duplicate signal for the same index/strategy/15-minute candle is suppressed.

## Option selection
- Bullish underlying signal selects long CE; bearish selects long PE.
- Start with ATM or one strike ITM, but rank only live tradable contracts from the instrument master.
- Require positive bid/ask, non-crossed market, fresh quote, configured maximum spread, and sufficient traded volume/OI.
- Do not assume option Greeks are supplied by Kite. Use Greeks only if a verified source or tested model is available; otherwise omit delta gating and clearly show that it is unavailable.
- Never hardcode lot size, tick size, strike interval, expiry weekday, or instrument token.

## Risk rules
- User must set exact `TRADING_CAPITAL_INR` below ₹100,000; zero or unset disables actionable recommendations.
- Risk per trade = 0.5% of configured capital, inclusive of estimated charges and slippage buffer.
- Daily stop = 1.5% of configured capital. This build sums realized P&L manually entered when a traded recommendation is closed and blocks further recommendations after the configured limit. It does not ingest broker P&L or unrealized open-position loss; the operator must monitor those separately. Do not treat this manual ledger as a complete broker-side risk control.
- At most two entries per day across both indices combined; at most one open position.
- If one lot's risk exceeds allowance, skip the trade. Do not reduce stop distance merely to make a lot affordable.
- Initial underlying invalidation reference can use 1.5x ATR(14), but translate to option premium risk through tested scenarios; an underlying ATR stop is not the same as a guaranteed premium stop.
- Target planning minimum 1.5R. Do not imply a target is guaranteed.
- Default no-new-entry window: before 09:45 and after 14:30 IST. The current clock helper excludes weekends but does not load an official exchange holiday calendar; verify holidays and special sessions manually.

## Mandatory HOLD / SKIP cases
- 1-hour and 15-minute trend disagree.
- Missing or stale data, incomplete candle, missing futures VWAP/volume, or indicator warm-up insufficient.
- ADX < 22 or DI direction mismatch.
- RSI outside the configured band.
- No price-action trigger.
- Score below 85.
- Spread/quote quality/liquidity fails.
- No lot affordable within risk cap.
- Position already open, daily trade cap reached, daily loss hit, or duplicate candle signal.
- Outside allowed entry window or exchange holiday.

## Implementation boundary in this build
- Completed-candle, OHLC validity, chronology, indicator/candle close alignment, and stale/future timestamps are checked before a directional signal can pass. The hourly trend timestamp allows up to 75 minutes of age; 15-minute and futures candle snapshots allow one full 15-minute interval plus a 2-minute feed grace. Option quotes have a separate 2-minute freshness check.
- Option quote timestamps are required; an absent timestamp is not replaced with the local clock.
- Capital must be configured before a recommendation can be emitted. Both stop-risk budget and full long-option premium notional are checked.
- Daily realized P&L is persisted locally only when the operator records it on closing a manually traded recommendation. Broker positions, fills, margin and intratrade drawdown are not synchronized.
- The approval service is not wired into the dashboard, and the Kite order adapter is a disabled placeholder. This build is not live-trading capable.
