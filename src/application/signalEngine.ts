import crypto from "node:crypto";
import path from "node:path";
import { env, kiteConfigured } from "../config/env.js";
import { updateEnvValue } from "../config/envFile.js";
import { DEFAULTS } from "../config/defaults.js";
import type { Candle, IndexSymbol, MarketSnapshot, OptionCandidate, OptionType, SignalDecision, TradingSignal } from "../domain/types.js";
import { getInstruments, listOptionContracts, resolveFuturesInstrument, resolveIndexInstrument, type Instrument } from "../broker/instrumentMaster.js";
import { fetchHistoricalCandles, fetchQuotes, requestAccessToken, type KiteCredentials, type KiteCandle } from "../broker/kiteClient.js";
import { buildFuturesIndicators, buildHourlyIndicators, buildSpotIndicators15m } from "./snapshotBuilder.js";
import { completedCandles, isMarketOpen, isWithinEntryWindow, istDateKey } from "./marketClock.js";
import { evaluatePrecision15 } from "../strategy/precisionStrategy.js";
import { altEntryAction } from "../strategy/altStrategies.js";
import { chooseLiquidOption } from "../options/optionSelector.js";
import { calculateAffordableLots, DEFAULT_RISK_CONFIG, hasHitDailyLossLimit } from "../risk/riskManager.js";
import { DailySignalLimiter } from "./dailySignalLimiter.js";
import { SignalStore } from "./signalStore.js";
import { TelegramNotifier } from "../notifications/telegram.js";

const SYMBOLS: IndexSymbol[] = ["NIFTY", "SENSEX"];
const SPOT_EXCHANGE: Record<IndexSymbol, string> = { NIFTY: "NSE", SENSEX: "BSE" };
const FUTURES_EXCHANGE: Record<IndexSymbol, "NFO" | "BFO"> = { NIFTY: "NFO", SENSEX: "BFO" };
const OPTION_RULES = {
  maxSpreadPercent: DEFAULTS.maxSpreadPercent,
  maxQuoteAgeMs: 120_000,
  minimumVolume: 1_000,
  minimumOpenInterest: 500,
};
const ESTIMATED_COSTS_PER_LOT_INR = 60;
const SLIPPAGE_BUFFER_PCT = 0.002;
const SIGNAL_VALIDITY_MINUTES = 30;

export interface SymbolStatus {
  symbol: IndexSymbol;
  evaluatedAt: string | null;
  candleTimestamp: string | null;
  dataAsOf: string | null;
  decision: SignalDecision | null;
  suppressedReason: string | null;
  error: string | null;
}

export interface EngineStatus {
  time: string;
  timeZone: string;
  kiteConfigured: boolean;
  marketOpen: boolean;
  entryWindowOpen: boolean;
  capitalConfigured: boolean;
  dailyRealizedPnlInr: number;
  dailyLossLimitHit: boolean;
  symbols: Record<IndexSymbol, SymbolStatus>;
  latestSignals: Partial<Record<IndexSymbol, TradingSignal>>;
}

function toCandle(k: KiteCandle): Candle {
  return { timestamp: k.timestamp, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume, complete: true };
}

function roundToTick(price: number, tickSize: number, round: "up" | "down"): number {
  const ticks = price / tickSize;
  const rounded = round === "up" ? Math.ceil(ticks - 1e-9) : Math.floor(ticks + 1e-9);
  return Number((rounded * tickSize).toFixed(4));
}

function optionTypeFor(action: "BUY_CALL" | "BUY_PUT"): OptionType {
  return action === "BUY_CALL" ? "CE" : "PE";
}

export class SignalEngine {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tickInProgress = false;
  private readonly limiter: DailySignalLimiter;
  private readonly statuses = new Map<IndexSymbol, SymbolStatus>();
  private readonly credentials: KiteCredentials;
  private readonly store: SignalStore;
  private readonly telegram: TelegramNotifier | null;
  private readonly timeZone: string;
  private readonly pollMs: number;
  private telegramTimer: NodeJS.Timeout | null = null;
  private telegramOffset = 0;
  private telegramPrimed = false;
  private readonly envFilePath = path.resolve(process.cwd(), ".env");

  constructor(options: { store: SignalStore; pollMs?: number }) {
    this.store = options.store;
    this.pollMs = options.pollMs ?? 30_000;
    this.credentials = { apiKey: env.KITE_API_KEY ?? "", apiSecret: env.KITE_API_SECRET, accessToken: env.KITE_ACCESS_TOKEN };
    this.timeZone = env.APP_TIMEZONE;
    this.telegram = env.TELEGRAM_ENABLED === "true" && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID
      ? new TelegramNotifier({ botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID })
      : null;
    this.limiter = new DailySignalLimiter(env.MAX_TRADES_PER_DAY, env.MAX_OPEN_RECOMMENDATIONS);
    for (const symbol of SYMBOLS) {
      this.statuses.set(symbol, { symbol, evaluatedAt: null, candleTimestamp: null, dataAsOf: null, decision: null, suppressedReason: null, error: null });
    }
    this.restoreDailyState();
  }

  private restoreDailyState(): void {
    const today = new Date();
    const todayKey = istDateKey(today, this.timeZone);
    for (const signal of this.store.all()) {
      const signalIsToday = istDateKey(new Date(signal.createdAt), this.timeZone) === todayKey;
      if (signalIsToday && signal.status === "SKIPPED_RISK_BUDGET") {
        this.limiter.record(signal, todayKey, false);
        continue;
      }
      if (signal.status !== "CANDIDATE") continue;
      if (signalIsToday) this.limiter.record(signal, todayKey, true);
      if (!this.store.isClosed(signal.id)) this.limiter.markPositionOpen(signal.symbol);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    this.timer.unref?.();
    if (this.telegram?.isConfigured) {
      void this.pollTelegram();
      this.telegramTimer = setInterval(() => void this.pollTelegram(), 10_000);
      this.telegramTimer.unref?.();
    }
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    if (this.telegramTimer) clearInterval(this.telegramTimer);
    this.timer = null;
    this.telegramTimer = null;
  }

  /** Persist a fresh Kite access token in memory and in .env so the engine uses it immediately. */
  setAccessToken(accessToken: string): void {
    this.credentials.accessToken = accessToken;
    env.KITE_ACCESS_TOKEN = accessToken;
    updateEnvValue(this.envFilePath, "KITE_ACCESS_TOKEN", accessToken);
  }

  private async pollTelegram(): Promise<void> {
    if (!this.telegram?.isConfigured) return;
    try {
      const updates = await this.telegram.getUpdates(this.telegramOffset);
      if (!this.telegramPrimed) {
        // discard backlog so old chat messages are not treated as commands
        this.telegramPrimed = true;
        if (updates.length) this.telegramOffset = updates[updates.length - 1]!.update_id + 1;
        return;
      }
      for (const update of updates) {
        this.telegramOffset = update.update_id + 1;
        const message = update.message;
        if (!message?.text) continue;
        if (String(message.chat.id) !== String(env.TELEGRAM_CHAT_ID)) continue;
        await this.handleTelegramMessage(message.text.trim());
      }
    } catch {
      // polling failure is non-fatal; try again next interval
    }
  }

  private async handleTelegramMessage(text: string): Promise<void> {
    if (!this.telegram) return;
    if (text === "/status") {
      const st = this.status();
      const lines = SYMBOLS.map((sym) => {
        const s = st.symbols[sym];
        return `${sym}: ${s.decision ? `${s.decision.action} (score ${s.decision.score})` : s.error ?? "evaluating"} | data ${s.dataAsOf ?? "—"}`;
      });
      await this.telegram.send(["TradePulse status", `Market ${st.marketOpen ? "open" : "closed"} · entry window ${st.entryWindowOpen ? "open" : "closed"}`, ...lines].join("\n"));
      return;
    }
    const result = await this.exchangeRequestToken(text);
    if (result.ok) {
      await this.telegram.send(`✅ Kite login successful (${result.userId}). Access token saved to .env — signals resume on the next poll.`);
    } else {
      await this.telegram.send(`❌ Token exchange failed: ${result.error}\nSend the request_token from the Zerodha redirect URL and try again.`);
    }
  }

  /** Exchange a Kite request_token for a daily access token. Saves to .env on success. */
  async exchangeRequestToken(requestToken: string): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
    if (!env.KITE_API_KEY || !env.KITE_API_SECRET) {
      return { ok: false, error: "KITE_API_KEY or KITE_API_SECRET is missing in .env." };
    }
    try {
      const result = await requestAccessToken(
        { apiKey: env.KITE_API_KEY, apiSecret: env.KITE_API_SECRET },
        requestToken,
      );
      this.setAccessToken(result.accessToken);
      return { ok: true, userId: result.userId };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  status(): EngineStatus {
    const symbols = {} as Record<IndexSymbol, SymbolStatus>;
    for (const symbol of SYMBOLS) symbols[symbol] = { ...this.statuses.get(symbol)! };
    const now = new Date();
    const capitalConfigured = env.TRADING_CAPITAL_INR > 0 && env.TRADING_CAPITAL_INR < env.MAX_CAPITAL_INR;
    const dailyRealizedPnlInr = this.store.dailyRealizedPnl(now, this.timeZone);
    return {
      time: now.toISOString(),
      timeZone: this.timeZone,
      kiteConfigured: kiteConfigured(),
      marketOpen: isMarketOpen(now, this.timeZone),
      entryWindowOpen: isWithinEntryWindow(now, this.timeZone),
      capitalConfigured,
      dailyRealizedPnlInr,
      dailyLossLimitHit: capitalConfigured && hasHitDailyLossLimit(env.TRADING_CAPITAL_INR, dailyRealizedPnlInr, env.MAX_DAILY_LOSS_PERCENT),
      symbols,
      latestSignals: Object.fromEntries(this.store.latestBySymbol()),
    };
  }

  closeSignal(id: string, realizedPnlInr: number): boolean {
    const closed = this.store.close(id, realizedPnlInr);
    if (closed) {
      const signal = this.store.all().find((s) => s.id === id);
      if (signal) this.limiter.markPositionClosed(signal.symbol);
    }
    return closed;
  }

  dismissSignal(id: string): boolean {
    const dismissed = this.store.dismiss(id);
    if (dismissed) {
      const signal = this.store.all().find((s) => s.id === id);
      if (signal) this.limiter.markPositionClosed(signal.symbol);
    }
    return dismissed;
  }

  async tick(): Promise<void> {
    // Avoid overlapping poll cycles and process symbols sequentially. Both
    // guards matter: option quote requests are asynchronous, so parallel
    // NIFTY/SENSEX evaluation could otherwise pass the one-open gate twice.
    if (!this.running || this.tickInProgress) return;
    this.tickInProgress = true;
    try {
      for (const symbol of SYMBOLS) {
        try {
          await this.evaluateSymbol(symbol);
        } catch (error) {
          const status = this.statuses.get(symbol)!;
          status.error = error instanceof Error ? error.message : String(error);
          status.evaluatedAt = new Date().toISOString();
        }
      }
    } finally {
      this.tickInProgress = false;
    }
  }

  private async evaluateSymbol(symbol: IndexSymbol): Promise<void> {
    const status = this.statuses.get(symbol)!;
    status.error = null;
    status.suppressedReason = null;
    if (!kiteConfigured()) {
      status.error = "Kite credentials are not configured (KITE_API_KEY / KITE_ACCESS_TOKEN).";
      status.evaluatedAt = new Date().toISOString();
      return;
    }
    const now = new Date();
    const spotExchange = SPOT_EXCHANGE[symbol];
    const futuresExchange = FUTURES_EXCHANGE[symbol];

    const [spotMaster, futuresMaster] = await Promise.all([
      getInstruments(this.credentials, spotExchange),
      getInstruments(this.credentials, futuresExchange),
    ]);
    const indexInstrument = resolveIndexInstrument(spotMaster, symbol);
    const futuresInstrument = resolveFuturesInstrument(futuresMaster, symbol, now);

    const from15m = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const from1h = new Date(now.getTime() - 80 * 24 * 60 * 60 * 1000);
    const [spot15Raw, spot1hRaw, futures15Raw] = await Promise.all([
      fetchHistoricalCandles(this.credentials, indexInstrument.instrumentToken, "15minute", from15m, now, false, this.timeZone),
      fetchHistoricalCandles(this.credentials, indexInstrument.instrumentToken, "60minute", from1h, now, false, this.timeZone),
      fetchHistoricalCandles(this.credentials, futuresInstrument.instrumentToken, "15minute", from15m, now, true, this.timeZone),
    ]);
    // Historical endpoints may include the still-forming candle. Exclude it
    // before exposing the series to any strategy or trigger validation.
    const spot15m = completedCandles(spot15Raw.map(toCandle), 15, now);
    const spot1h = completedCandles(spot1hRaw.map(toCandle), 60, now);
    const futures15m = completedCandles(futures15Raw.map(toCandle), 15, now);

    const spotIndicators15m = buildSpotIndicators15m(spot15m, now);
    const spotIndicators1h = buildHourlyIndicators(spot1h, now);
    const futuresIndicators15m = buildFuturesIndicators(futures15m, now, this.timeZone);
    status.evaluatedAt = now.toISOString();
    if (!spotIndicators15m || !spotIndicators1h || !futuresIndicators15m) {
      status.decision = null;
      status.error = "Insufficient candle history or invalid indicator data (warm-up or stale feed).";
      return;
    }

    const snapshot: MarketSnapshot = {
      symbol,
      spot15m, spot1h, futures15m,
      spotIndicators15m, spotIndicators1h, futuresIndicators15m,
      marketOpen: isMarketOpen(now, this.timeZone),
    };

    if (env.STRATEGY_MODE !== "precision15") {
      const byDay = new Map<string, Candle[]>();
      for (const c of spot15m) {
        const k = istDateKey(new Date(Date.parse(c.timestamp) + 15 * 60_000), this.timeZone);
        const arr = byDay.get(k) ?? [];
        arr.push(c);
        byDay.set(k, arr);
      }
      const dayKeys = [...byDay.keys()].sort();
      const todayCandles = byDay.get(dayKeys.at(-1) ?? "") ?? [];
      const prevDayClose = dayKeys.length > 1 ? byDay.get(dayKeys.at(-2)!)!.at(-1)!.close : todayCandles[0]?.open ?? 0;
      const altAction = snapshot.marketOpen
        ? altEntryAction(env.STRATEGY_MODE, todayCandles, prevDayClose, futuresIndicators15m.vwap)
        : null;
      const candleTs = spotIndicators15m.candleTimestamp;
      status.decision = altAction
        ? { action: altAction, regime: "UNCLEAR", score: 0, reasons: [`STRATEGY_MODE=${env.STRATEGY_MODE} — underlying-level entry, no option contract`], rejectedReasons: [] }
        : { action: "HOLD", regime: "UNCLEAR", score: 0, reasons: [], rejectedReasons: ["No alternative-strategy trigger on the latest completed candle"] };
      status.candleTimestamp = candleTs;
      status.dataAsOf = spotIndicators15m.dataAsOf;
      if (!altAction) return;
      const altDateKey = istDateKey(now, this.timeZone);
      if (!this.limiter.canEmit(altDateKey, symbol, candleTs)) {
        status.suppressedReason = "Daily signal cap reached, duplicate candle, or an open recommendation exists.";
        return;
      }
      if (!isWithinEntryWindow(now, this.timeZone)) {
        status.suppressedReason = "Signal qualified but is outside the 09:45–14:30 IST entry window.";
        return;
      }
      const optionType = optionTypeFor(altAction);
      const option = await this.selectOption(symbol, optionType, spotIndicators15m.lastClose, now, futuresMaster);
      if (!option) {
        status.suppressedReason = "No liquid option contract passed spread/volume/OI/quote-age checks.";
        return;
      }
      const decision: SignalDecision = {
        action: altAction, regime: "UNCLEAR", score: 0,
        reasons: [`STRATEGY_MODE=${env.STRATEGY_MODE} — ${env.STRATEGY_MODE === "vwap" ? "VWAP reclaim" : "gap-fade"} entry`],
        rejectedReasons: [],
      };
      const signal = this.buildSignal(symbol, decision, option, spotIndicators15m, futuresInstrument, now);
      if (!signal) {
        status.suppressedReason = "Risk budget check failed for the selected option.";
        return;
      }
      this.store.add(signal);
      this.limiter.record(signal, altDateKey);
      this.limiter.markPositionOpen(symbol);
      status.suppressedReason = null;
      void this.notify(signal);
      return;
    }

    const decision = evaluatePrecision15(snapshot, {
      minSignalScore: env.MIN_SIGNAL_SCORE,
      minAdx: DEFAULTS.minAdx,
      minRelativeVolume: DEFAULTS.minRelativeVolume,
    }, now);
    status.decision = decision;
    status.candleTimestamp = spotIndicators15m.candleTimestamp;
    status.dataAsOf = spotIndicators15m.dataAsOf;

    if (decision.action === "HOLD") return;

    const dateKey = istDateKey(now, this.timeZone);
    const dailyPnl = this.store.dailyRealizedPnl(now, this.timeZone);
    if (hasHitDailyLossLimit(env.TRADING_CAPITAL_INR, dailyPnl, env.MAX_DAILY_LOSS_PERCENT)) {
      status.suppressedReason = `Daily loss limit reached. Realized P&L recorded today: ₹${dailyPnl.toFixed(2)}.`;
      return;
    }
    const candleTimestamp = spotIndicators15m.candleTimestamp;
    if (!this.limiter.canEmit(dateKey, symbol, candleTimestamp)) {
      status.suppressedReason = "Daily signal cap reached, duplicate candle, or an open recommendation exists.";
      return;
    }
    if (!isWithinEntryWindow(now, this.timeZone)) {
      status.suppressedReason = "Signal qualified but is outside the 09:45–14:30 IST entry window.";
      return;
    }
    const optionType = optionTypeFor(decision.action);
    const option = await this.selectOption(symbol, optionType, spotIndicators15m.lastClose, now, futuresMaster);
    if (!option) {
      status.suppressedReason = "No liquid option contract passed spread/volume/OI/quote-age checks.";
      return;
    }

    const signal = this.buildSignal(symbol, decision, option, spotIndicators15m, futuresInstrument, now);
    if (!signal) {
      status.suppressedReason = "Capital/risk budget check failed — one lot is not affordable within configured capital and per-trade risk allowance.";
      const skipped = this.recordSkipped(symbol, decision, option, "SKIPPED_RISK_BUDGET", "One lot fails configured capital or per-trade risk budget.", spotIndicators15m.candleTimestamp);
      this.limiter.record(skipped, dateKey, false);
      void this.notify(skipped);
      return;
    }

    this.store.add(signal);
    this.limiter.record(signal, dateKey);
    this.limiter.markPositionOpen(symbol);
    status.suppressedReason = null;
    void this.notify(signal);
  }

  private async selectOption(
    symbol: IndexSymbol,
    optionType: OptionType,
    spotPrice: number,
    now: Date,
    futuresMaster: Instrument[],
  ): Promise<OptionCandidate | null> {
    const exchange = FUTURES_EXCHANGE[symbol];
    const contracts = listOptionContracts(futuresMaster, symbol, optionType, spotPrice, 0.02, now);
    if (!contracts.length) return null;
    const keys = contracts.map((c) => `${exchange}:${c.tradingsymbol}`);
    const quotes = await fetchQuotes(this.credentials, keys);
    const candidates: OptionCandidate[] = [];
    for (const contract of contracts) {
      const quote = quotes[`${exchange}:${contract.tradingsymbol}`];
      const bid = quote?.depth?.buy?.[0]?.price;
      const ask = quote?.depth?.sell?.[0]?.price;
      // Missing exchange timestamps must fail closed; do not disguise an
      // un-timestamped quote as fresh by substituting the current local time.
      if (!quote || !quote.timestamp || !bid || !ask) continue;
      candidates.push({
        exchange,
        tradingsymbol: contract.tradingsymbol,
        instrumentToken: contract.instrumentToken,
        underlying: symbol,
        optionType,
        expiry: contract.expiry,
        strike: contract.strike,
        lotSize: contract.lotSize,
        tickSize: contract.tickSize,
        ltp: quote.last_price,
        bid,
        ask,
        volume: quote.volume,
        openInterest: quote.oi ?? 0,
        quoteAsOf: quote.timestamp,
      });
    }
    return chooseLiquidOption(candidates, {
      underlying: symbol,
      optionType,
      spotPrice,
      now,
      ...OPTION_RULES,
    });
  }

  private buildSignal(
    symbol: IndexSymbol,
    decision: SignalDecision,
    option: OptionCandidate,
    indicators: NonNullable<ReturnType<typeof buildSpotIndicators15m>>,
    futuresInstrument: Instrument,
    now: Date,
  ): TradingSignal | null {
    const premiumEntry = option.ask;
    const entryLimitPrice = roundToTick(premiumEntry, option.tickSize, "up");
    const direction = decision.action === "BUY_CALL" ? 1 : -1;
    const underlyingStopDistance = env.STOP_ATR_MULTIPLE * indicators.atr14;
    const premiumStopDistance = underlyingStopDistance * env.OPTION_DELTA_APPROX;
    const premiumStop = roundToTick(entryLimitPrice - premiumStopDistance, option.tickSize, "down");
    if (!(entryLimitPrice > 0 && premiumStop > 0 && premiumStop < entryLimitPrice)) return null;
    const targetDistance = env.TARGET_R_MULTIPLE * (entryLimitPrice - premiumStop);
    const targetPremium = roundToTick(entryLimitPrice + targetDistance, option.tickSize, "up");
    const underlyingStopLevel = Number((indicators.lastClose - direction * underlyingStopDistance).toFixed(2));
    const underlyingTargetLevel = Number((indicators.lastClose + direction * env.TARGET_R_MULTIPLE * underlyingStopDistance).toFixed(2));

    const riskConfig = {
      ...DEFAULT_RISK_CONFIG,
      maxCapitalInr: env.MAX_CAPITAL_INR,
      riskPerTradePercent: env.RISK_PER_TRADE_PERCENT,
      dailyLossLimitPercent: env.MAX_DAILY_LOSS_PERCENT,
    };
    const risk = calculateAffordableLots({
      capitalInr: env.TRADING_CAPITAL_INR,
      premiumEntry: entryLimitPrice,
      premiumStop,
      lotSize: option.lotSize,
      estimatedCostsPerLot: ESTIMATED_COSTS_PER_LOT_INR,
      slippageBufferPerLot: entryLimitPrice * option.lotSize * SLIPPAGE_BUFFER_PCT,
    }, riskConfig);
    if (!risk.affordable) return null;
    // A long option is paid for in full. Risk-budget sizing alone must not
    // recommend a premium notional larger than the capital configured by the user.
    const notionalPerLot = entryLimitPrice * option.lotSize + ESTIMATED_COSTS_PER_LOT_INR;
    const lotsAffordableByCapital = Math.floor(env.TRADING_CAPITAL_INR / notionalPerLot);
    const affordableLots = Math.min(risk.affordableLots, lotsAffordableByCapital);
    if (affordableLots < 1) return null;
    const riskPerLotInr = risk.riskPerLotInr;
    const quantity = affordableLots * option.lotSize;

    return {
      id: crypto.randomUUID(),
      symbol,
      action: decision.action,
      status: "CANDIDATE",
      regime: decision.regime,
      score: decision.score,
      reasons: [...decision.reasons, `Futures contract: ${futuresInstrument.tradingsymbol} (expiry ${futuresInstrument.expiry})`, "Premium stop/target are approximations (configured delta proxy; no verified Greeks) — verify manually."],
      rejectedReasons: decision.rejectedReasons,
      candleTimestamp: indicators.candleTimestamp,
      createdAt: now.toISOString(),
      option,
      quantity,
      entryLimitPrice,
      stopLossPremium: premiumStop,
      targetPremium,
      underlyingStopLevel,
      underlyingTargetLevel,
      maxRiskInr: riskPerLotInr * affordableLots,
      approvalExpiresAt: new Date(Date.parse(indicators.candleTimestamp) + SIGNAL_VALIDITY_MINUTES * 60_000).toISOString(),
    };
  }

  private recordSkipped(symbol: IndexSymbol, decision: SignalDecision, option: OptionCandidate, status: TradingSignal["status"], reason: string, candleTimestamp: string): TradingSignal {
    const skipped: TradingSignal = {
      id: crypto.randomUUID(),
      symbol,
      action: decision.action === "HOLD" ? "BUY_CALL" : decision.action,
      status,
      regime: decision.regime,
      score: decision.score,
      reasons: decision.reasons,
      rejectedReasons: [...decision.rejectedReasons, reason],
      candleTimestamp,
      createdAt: new Date().toISOString(),
      option,
    };
    this.store.add(skipped);
    return skipped;
  }

  private async notify(signal: TradingSignal): Promise<void> {
    if (!this.telegram?.isConfigured) return;
    if (!signal.option) {
      const lines = [
        `TradePulse ${signal.action} — ${signal.symbol} [${env.STRATEGY_MODE}]`,
        `Underlying entry ~${signal.entryLimitPrice} | stop ${signal.underlyingStopLevel ?? "—"} | target ${signal.underlyingTargetLevel ?? "—"}`,
        `Candle ${signal.candleTimestamp} | valid ~30min — execute manually. Dashboard: http://127.0.0.1:${env.PORT}`,
      ];
      try {
        await this.telegram.send(lines.join("\n"));
      } catch {
        // notification failure must not affect signal state
      }
      return;
    }
    const o = signal.option;
    const skipped = signal.status === "SKIPPED_RISK_BUDGET";
    const lines = [
      skipped
        ? `⚠️ TradePulse ${signal.action} SKIPPED — ${signal.symbol} (risk budget)`
        : `TradePulse ${signal.action} — ${signal.symbol}`,
      signal.score > 0
        ? `Score ${signal.score}/100 (confluence, not a probability) | Regime: ${signal.regime}`
        : `Rule-based trigger (${env.STRATEGY_MODE}) — no confluence score | Regime: ${signal.regime}`,
      `Contract: ${o.exchange}:${o.tradingsymbol} strike ${o.strike} exp ${o.expiry}`,
      `Bid ${o.bid} / Ask ${o.ask} / LTP ${o.ltp} | Qty ${signal.quantity ?? "-"}`,
      `Entry limit ~${signal.entryLimitPrice} | Premium stop ~${signal.stopLossPremium} | Target ~${signal.targetPremium}`,
      `Underlying ${signal.symbol}: stop ${signal.underlyingStopLevel ?? "—"} | target ${signal.underlyingTargetLevel ?? "—"}`,
      `Est. risk ~₹${Math.round(signal.maxRiskInr ?? 0)} | Candle ${signal.candleTimestamp}`,
      skipped
        ? "No action needed — suppressed by risk rules. Dashboard: http://127.0.0.1:" + env.PORT
        : `Valid until ${signal.approvalExpiresAt} — place orders manually. Dashboard: http://127.0.0.1:${env.PORT}`,
    ];
    try {
      await this.telegram.send(lines.join("\n"));
    } catch {
      // notification failure must not affect signal state
    }
  }
}
