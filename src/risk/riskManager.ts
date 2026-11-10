export interface RiskInput {
  capitalInr: number;
  premiumEntry: number;
  premiumStop: number;
  lotSize: number;
  estimatedCostsPerLot?: number;
  slippageBufferPerLot?: number;
}
export interface RiskResult {
  allowedRiskInr: number;
  riskPerLotInr: number;
  affordableLots: number;
  affordable: boolean;
  reason?: string;
}

export function calculateAffordableLots(input: RiskInput): RiskResult {
  if (!(input.capitalInr > 0 && input.capitalInr < 100_000)) return { allowedRiskInr: 0, riskPerLotInr: 0, affordableLots: 0, affordable: false, reason: "Set actual capital below ₹1,00,000" };
  if (!(input.premiumEntry > 0 && input.premiumStop >= 0 && input.premiumStop < input.premiumEntry && input.lotSize > 0)) return { allowedRiskInr: input.capitalInr * 0.005, riskPerLotInr: 0, affordableLots: 0, affordable: false, reason: "Invalid premium, stop or lot size" };
  const allowedRiskInr = input.capitalInr * 0.005;
  const riskPerLotInr = (input.premiumEntry - input.premiumStop) * input.lotSize + (input.estimatedCostsPerLot ?? 0) + (input.slippageBufferPerLot ?? 0);
  const affordableLots = riskPerLotInr > 0 ? Math.floor(allowedRiskInr / riskPerLotInr) : 0;
  return { allowedRiskInr, riskPerLotInr, affordableLots, affordable: affordableLots >= 1, ...(!affordableLots ? { reason: "One lot exceeds the per-trade risk budget" } : {}) };
}

export function hasHitDailyLossLimit(capitalInr: number, dailyPnlInr: number): boolean {
  return capitalInr <= 0 || dailyPnlInr <= -(capitalInr * 0.015);
}
