import { randomUUID } from "node:crypto";
import type { TradingSignal } from "../domain/types.js";

interface ApprovalRecord { token: string; signalId: string; expiresAt: number; used: boolean; }

export class ApprovalService {
  private readonly approvals = new Map<string, ApprovalRecord>();

  create(signal: TradingSignal, ttlSeconds = 30): ApprovalRecord {
    const record = { token: randomUUID(), signalId: signal.id, expiresAt: Date.now() + ttlSeconds * 1000, used: false };
    this.approvals.set(record.token, record);
    return record;
  }

  consume(token: string, signalId: string): boolean {
    const record = this.approvals.get(token);
    if (!record || record.used || record.signalId !== signalId || record.expiresAt < Date.now()) return false;
    record.used = true;
    return true;
  }
}
