import type { IndexSymbol } from "../domain/types.js";
import type { MarketDataProvider, OrderGateway, OrderIntent } from "./ports.js";

/**
 * Deliberately incomplete adapter boundary. Devin must implement against current
 * Kite Connect docs and cover it with contract/integration tests. Do not place
 * real orders from this placeholder.
 */
export class KiteAdapter implements MarketDataProvider, OrderGateway {
  async getMarketSnapshot(_symbol: IndexSymbol): Promise<never> {
    throw new Error("Kite market-data adapter is not configured. Live signals are unavailable.");
  }
  async getOptionCandidates(_symbol: IndexSymbol, _optionType: "CE" | "PE"): Promise<never> {
    throw new Error("Kite option-chain/instrument resolver is not configured.");
  }
  async getAvailableFunds(): Promise<number> {
    throw new Error("Kite funds endpoint is not configured.");
  }
  async getOpenPositionsCount(): Promise<number> {
    throw new Error("Kite positions endpoint is not configured.");
  }
  async placeLimitOrder(_intent: OrderIntent): Promise<never> {
    throw new Error("Live order placement is disabled in this scaffold.");
  }
  async getOrderStatus(_orderId: string): Promise<never> {
    throw new Error("Kite order reconciliation is not configured.");
  }
}
