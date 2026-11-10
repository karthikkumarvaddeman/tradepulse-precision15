import express from "express";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, capitalConfigured, isLiveOrderEnabled } from "./config/env.js";

const app = express();
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(currentDir, "../public");

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "32kb" }));
app.use(express.static(publicDir));

app.get("/api/health", (_req, res) => {
  res.json({
    status: "STARTER_SCAFFOLD",
    mode: env.TRADING_MODE,
    liveOrderPlacementEnabled: isLiveOrderEnabled,
    capitalConfigured,
    liveMarketDataConfigured: false,
    message: "No live market feed or order gateway is wired in this starter. Do not treat this as a live signal service.",
  });
});

app.get("/api/signals", (_req, res) => {
  res.json({ signals: [], message: "No signals until Devin implements and connects the Kite market-data provider." });
});

app.post("/api/signals/:id/approval-token", (_req, res) => {
  return res.status(501).json({ error: "Approval workflow is not implemented. No token or order can be created in this scaffold." });
});

app.post("/api/approvals/:token/confirm", (_req, res) => {
  return res.status(501).json({ error: "Order approval and placement are not implemented. Live orders are disabled." });
});

app.listen(env.PORT, env.HOST, () => {
  console.log(`TradePulse Precision 15 listening at http://${env.HOST}:${env.PORT}`);
  console.log(`Mode=${env.TRADING_MODE}; liveOrders=${isLiveOrderEnabled}; capitalConfigured=${capitalConfigured}`);
});
