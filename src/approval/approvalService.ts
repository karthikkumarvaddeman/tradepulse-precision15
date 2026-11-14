import { randomUUID } from "node:crypto";
import type { TradingSignal } from "../domain/types.js";

/** The exact order terms an approval is bound to. Any mismatch invalidates the token. */
export interface ApprovalBinding {
  signalId: string;
  exchange: "NFO" | "BFO";
  tradingsymbol: string;
  quantity: number;
  limitPrice: number;
}

export interface ApprovalRecord extends ApprovalBinding {
  token: string;
  expiresAt: number;
  used: boolean;
}

const PRICE_TOLERANCE = 1e-9;

function bindingsMatch(record: ApprovalBinding, expected: ApprovalBinding): boolean {
  return record.signalId === expected.signalId &&
    record.exchange === expected.exchange &&
    record.tradingsymbol === expected.tradingsymbol &&
    record.quantity === expected.quantity &&
    Math.abs(record.limitPrice - expected.limitPrice) <= PRICE_TOLERANCE;
}

export class ApprovalService {
  private readonly approvals = new Map<string, ApprovalRecord>();

  create(signal: TradingSignal, binding: Omit<ApprovalBinding, "signalId">, ttlSeconds = 30): ApprovalRecord {
    const record: ApprovalRecord = {
      token: randomUUID(),
      signalId: signal.id,
      ...binding,
      expiresAt: Date.now() + ttlSeconds * 1000,
      used: false,
    };
    this.approvals.set(record.token, record);
    return record;
  }

  consume(token: string, expected: ApprovalBinding): boolean {
    const record = this.approvals.get(token);
    if (!record || record.used || record.expiresAt < Date.now() || !bindingsMatch(record, expected)) return false;
    record.used = true;
    return true;
  }

  /** Read-only lookup so the dashboard can display what a token is bound to before confirming. */
  inspect(token: string): ApprovalRecord | null {
    const record = this.approvals.get(token);
    if (!record || record.used || record.expiresAt < Date.now()) return null;
    return record;
  }
}
