import type { IndexSymbol, OptionCandidate, OptionType } from "../domain/types.js";
import { getExchangeForIndex } from "../strategy/precisionStrategy.js";

export interface OptionSelectionRules {
  underlying: IndexSymbol;
  optionType: OptionType;
  spotPrice: number;
  now: Date;
  maxSpreadPercent: number;
  maxQuoteAgeMs: number;
  minimumVolume: number;
  minimumOpenInterest: number;
}

export function chooseLiquidOption(candidates: OptionCandidate[], rules: OptionSelectionRules): OptionCandidate | null {
  const expectedExchange = getExchangeForIndex(rules.underlying);
  const valid = candidates.filter(option => {
    const spreadPercent = option.ask > 0 ? ((option.ask - option.bid) / option.ask) * 100 : Infinity;
    const quoteAge = rules.now.getTime() - Date.parse(option.quoteAsOf);
    const rightSideOfSpot = rules.optionType === "CE" ? option.strike <= rules.spotPrice : option.strike >= rules.spotPrice;
    const nearAtm = Math.abs(option.strike - rules.spotPrice) <= Math.max(rules.spotPrice * 0.01, 500);
    return option.underlying === rules.underlying && option.exchange === expectedExchange && option.optionType === rules.optionType &&
      option.ltp > 0 && option.bid > 0 && option.ask >= option.bid && spreadPercent <= rules.maxSpreadPercent &&
      quoteAge >= 0 && quoteAge <= rules.maxQuoteAgeMs && option.volume >= rules.minimumVolume &&
      option.openInterest >= rules.minimumOpenInterest && option.lotSize > 0 && option.tickSize > 0 && rightSideOfSpot && nearAtm;
  });
  valid.sort((a, b) => Math.abs(a.strike - rules.spotPrice) - Math.abs(b.strike - rules.spotPrice));
  return valid[0] ?? null;
}
