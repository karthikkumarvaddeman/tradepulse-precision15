# Strategy review variant

This is a separate working copy of the `tradepulse15` project. Existing strategy and risk configuration values are carried forward unchanged. The strategy still requires every specified confirmation and does not promise profitable or accurate signals.

## Copied values

| Setting | Value |
|---|---:|
| Entry timeframe | 15 minutes |
| Trend timeframe | 60 minutes |
| Minimum signal score | 85/100 |
| Minimum ADX | 22 |
| Minimum relative futures volume | 1.2x |
| Call RSI range | 55–68 |
| Put RSI range | 32–45 |
| Risk per trade | 0.5% of configured capital |
| Daily loss limit | 1.5% |
| Maximum recommendations per day | 2 across both indices |
| Maximum open recommendations | 1 |
| Entry window | 09:45–14:30 IST |
| Stop / target ATR multiples | 1.5 / 1.5 |
| Option delta proxy | 0.5 |

## Change in this copy

The futures snapshot now records the timestamp of the completed futures candle. Strategy evaluation rejects the snapshot unless that timestamp matches the latest completed spot entry candle. This prevents VWAP and volume confirmation from a different 15-minute interval from being combined with the spot trigger.

## Review observations and treatment

- All nine directional conditions remain hard gates. Their weights total 100, so a fully qualified signal scores 100; the 85-point threshold is retained from the supplied profile but does not rank actionable signals. HOLD scores are diagnostic only. Changing this requires a defined scoring model that still preserves all mandated hard gates.
- The price-action trigger remains a close beyond the immediately previous spot candle's high or low. A different breakout definition would change entries and needs historical comparison before adoption.
- Relative volume still uses same-time-slot history when enough samples exist, with a 20-candle fallback otherwise. The fallback is retained pending comparative historical evidence; the 1.2x threshold is unchanged.
- Premium stop and risk estimates use a configured delta proxy, not verified option Greeks. Dashboard and Telegram risk labels now identify this as a proxy estimate. Replacing it requires a verified Greeks or option-premium data source.

These observations are documented rather than silently changing entry criteria or copied risk values.
