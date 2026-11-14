import { DEFAULTS } from "../config/defaults.js";

export interface RiskConfig {
  maxCapitalInr: number;
  riskPerTradePercent: number;
  dailyLossLimitPercent: number;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxCapitalInr: 100_000,
  riskPerTradePercent: DEFAULTS.riskPerTradePercent,
  dailyLossLimitPercent: DEFAULTS.dailyLossLimitPercent,
};

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

export function calculateAffordableLots(input: RiskInput, config: RiskConfig = DEFAULT_RISK_CONFIG): RiskResult {
  const allowedRiskInr = input.capitalInr * (config.riskPerTradePercent / 100);
  if (!(input.capitalInr > 0 && input.capitalInr < config.maxCapitalInr)) {
    return { allowedRiskInr: 0, riskPerLotInr: 0, affordableLots: 0, affordable: false, reason: `Set actual capital above ₹0 and below ₹${config.maxCapitalInr.toLocaleString("en-IN")}` };
  }
  if (!(input.premiumEntry > 0 && input.premiumStop >= 0 && input.premiumStop < input.premiumEntry && input.lotSize > 0)) {
    return { allowedRiskInr, riskPerLotInr: 0, affordableLots: 0, affordable: false, reason: "Invalid premium, stop or lot size" };
  }
  const riskPerLotInr = (input.premiumEntry - input.premiumStop) * input.lotSize + (input.estimatedCostsPerLot ?? 0) + (input.slippageBufferPerLot ?? 0);
  const affordableLots = riskPerLotInr > 0 ? Math.floor(allowedRiskInr / riskPerLotInr) : 0;
  return {
    allowedRiskInr,
    riskPerLotInr,
    affordableLots,
    affordable: affordableLots >= 1,
    ...(affordableLots < 1 ? { reason: "One lot exceeds the per-trade risk budget" } : {}),
  };
}

export function hasHitDailyLossLimit(capitalInr: number, dailyPnlInr: number, dailyLossLimitPercent: number = DEFAULTS.dailyLossLimitPercent): boolean {
  return capitalInr <= 0 || dailyPnlInr <= -(capitalInr * (dailyLossLimitPercent / 100));
}
