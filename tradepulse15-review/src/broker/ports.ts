import type { IndexSymbol, OptionCandidate } from "../domain/types.js";

export interface MarketDataProvider {
  getMarketSnapshot(symbol: IndexSymbol): Promise<import("../domain/types.js").MarketSnapshot>;
  getOptionCandidates(symbol: IndexSymbol, optionType: "CE" | "PE"): Promise<OptionCandidate[]>;
  getAvailableFunds(): Promise<number>;
  getOpenPositionsCount(): Promise<number>;
}

export interface OrderIntent {
  signalId: string;
  exchange: "NFO" | "BFO";
  tradingsymbol: string;
  transactionType: "BUY";
  quantity: number;
  orderType: "LIMIT";
  price: number;
  product: "MIS";
}

export interface OrderGateway {
  placeLimitOrder(intent: OrderIntent): Promise<{ orderId: string; status: "PENDING" | "OPEN" | "COMPLETE" | "REJECTED" }>;
  getOrderStatus(orderId: string): Promise<string>;
}
