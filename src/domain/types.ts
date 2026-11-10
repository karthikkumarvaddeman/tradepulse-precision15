export type IndexSymbol = "NIFTY" | "SENSEX";
export type SignalAction = "BUY_CALL" | "BUY_PUT" | "HOLD";
export type OptionType = "CE" | "PE";
export type SignalStatus = "CANDIDATE" | "READY_FOR_APPROVAL" | "APPROVED" | "DECLINED" | "EXPIRED" | "SKIPPED" | "ORDER_PENDING" | "ORDER_UNKNOWN" | "ORDER_REJECTED" | "FILLED";
export type MarketRegime = "BULL_TREND" | "BEAR_TREND" | "SIDEWAYS" | "UNCLEAR";

export interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  complete: boolean;
}

export interface IndicatorSnapshot {
  ema20: number;
  ema50: number;
  ema200: number;
  rsi14: number;
  adx14: number;
  plusDi14: number;
  minusDi14: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  previousMacdHistogram: number;
  supertrendDirection: "BULLISH" | "BEARISH";
  atr14: number;
  vwap: number;
  futuresVolume: number;
  futuresVolumeSma20: number;
  previousCandleHigh: number;
  previousCandleLow: number;
  lastClose: number;
  candleTimestamp: string;
  dataAsOf: string;
}

export interface MarketSnapshot {
  symbol: IndexSymbol;
  spot15m: Candle[];
  spot1h: Candle[];
  futures15m: Candle[];
  spotIndicators15m: IndicatorSnapshot;
  spotIndicators1h: Pick<IndicatorSnapshot, "ema20" | "ema50" | "ema200" | "lastClose" | "candleTimestamp" | "dataAsOf">;
  futuresIndicators15m: Pick<IndicatorSnapshot, "vwap" | "futuresVolume" | "futuresVolumeSma20" | "dataAsOf">;
  marketOpen: boolean;
}

export interface OptionCandidate {
  exchange: "NFO" | "BFO";
  tradingsymbol: string;
  instrumentToken: number;
  underlying: IndexSymbol;
  optionType: OptionType;
  expiry: string;
  strike: number;
  lotSize: number;
  tickSize: number;
  ltp: number;
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
  quoteAsOf: string;
  delta?: number;
}

export interface TradingSignal {
  id: string;
  symbol: IndexSymbol;
  action: SignalAction;
  status: SignalStatus;
  regime: MarketRegime;
  score: number;
  reasons: string[];
  rejectedReasons: string[];
  candleTimestamp: string;
  createdAt: string;
  option?: OptionCandidate;
  quantity?: number;
  entryLimitPrice?: number;
  stopLossPremium?: number;
  targetPremium?: number;
  maxRiskInr?: number;
  approvalExpiresAt?: string;
}

export interface SignalDecision {
  action: SignalAction;
  regime: MarketRegime;
  score: number;
  reasons: string[];
  rejectedReasons: string[];
}
