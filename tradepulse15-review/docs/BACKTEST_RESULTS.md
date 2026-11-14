# Exploratory strategy backtest

Run date: 2026-11-14
Requested lookback: 180 calendar days
Strategy: review-project `Precision 15`, including spot/futures candle timestamp alignment
Data: Kite historical candles

## Results

| Date (IST) | Index | Action | Underlying entry | Underlying outcome | Points |
|---|---|---|---:|---|---:|
| 2026-09-08 10:45 | NIFTY | BUY_PUT | 23,669.30 | End-of-day exit at 23,635.10 | +34.2 |
| 2026-10-01 12:15 | SENSEX | BUY_PUT | 72,236.85 | 1.5R target reached at 71,931.36 | +305.5 |
| 2026-10-05 12:15 | SENSEX | BUY_PUT | 71,899.29 | ATR stop reached at 72,167.07 | -267.8 |
| 2026-11-12 10:45 | SENSEX | BUY_CALL | 82,251.97 | ATR stop reached at 81,969.79 | -282.2 |

The run evaluated 4,674 entry-window candles and emitted four signals after the daily cap. One reached its target, two reached their stops, and one exited at end of day. The three SENSEX outcomes sum to -244.5 index points; the NIFTY outcome was +34.2 points. **Do not combine points across indices as P&L.**

## Important limitations

- These are underlying-index point outcomes using the configured 1.5 ATR stop and 1.5R target. They are not option-premium returns and do not include option selection, delta changes, volatility, spread, slippage, charges, or lot sizing.
- Although the requested lookback was 180 days, the fetched current futures contracts had only 1,410 NIFTY and 1,306 SENSEX 15-minute candles, compared with 3,805 spot candles per index. The futures data therefore does not establish continuous coverage for the full requested period. Treat the four signals as an exploratory sample from available aligned history, not a full 180-day backtest.
- Historical contract selection and futures rolls are not reconstructed. A valid longer-range test needs archived instrument masters or historical contract identifiers and explicit roll handling.
- The script processes each index separately, so its one-open-position simulation is not a faithful combined NIFTY/SENSEX portfolio constraint. The two-signal daily cap is shared.
- Every qualifying signal scored 100 because every directional rule is a hard gate. The score is not a probability or a ranking of trades.
- No claim of predictive accuracy or profitability follows from this small sample.

## ADX / relative-volume filter experiment

The baseline and candidate were compared on the same fetched history using the same hard gates and exit simulation. The candidate changed only the minimum ADX and relative-volume thresholds.

| Variant | NIFTY | SENSEX |
|---|---|---|
| Baseline: ADX ≥22, relative volume ≥1.2× | 1 signal; 1 EOD; +34.2 points | 3 signals; 1 target, 2 stops; −244.5 points |
| Candidate: ADX ≥25, relative volume ≥1.5× | 1 signal; 1 EOD; +34.2 points | 1 target; +305.5 points |

The comparison built 1,745 valid snapshots (1,007 NIFTY and 738 SENSEX); 2,929 of the 4,674 entry-window evaluations lacked enough aligned futures history and were skipped. The candidate filtered the two SENSEX stop trades in this sample while retaining the SENSEX target and the NIFTY EOD exit.

This is a post-hoc, in-sample result: the thresholds were proposed after inspecting these four trades. It does **not** establish that the candidate is better. It was not an option-premium backtest, the futures coverage is incomplete, and points across indices are not comparable P&L. The application's configured thresholds remain ADX 22 and relative volume 1.2×. Any future adoption should follow continuous-futures and option-premium data validation plus a separate out-of-sample / walk-forward evaluation.
