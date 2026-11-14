import express from "express";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextFunction, Request, Response } from "express";
import { env, capitalConfigured, isLiveOrderEnabled, kiteConfigured } from "./config/env.js";
import { SignalStore } from "./application/signalStore.js";
import { SignalEngine } from "./application/signalEngine.js";

const app = express();
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(currentDir, "../public");
const signalStore = new SignalStore(path.resolve(currentDir, "../data/signals.json"));
const engine = new SignalEngine({ store: signalStore });

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "32kb" }));
app.use(express.static(publicDir));

const requireLocalToken = (req: Request, res: Response, next: NextFunction) => {
  const token = req.header("x-app-token");
  if (!token || token !== env.APP_LOCAL_ACCESS_TOKEN) {
    return res.status(401).json({ error: "Missing or invalid local access token." });
  }
  next();
};

app.get("/api/health", (_req, res) => {
  res.json({
    status: "STARTER_SCAFFOLD",
    mode: env.TRADING_MODE,
    liveOrderPlacementEnabled: isLiveOrderEnabled,
    capitalConfigured,
    liveMarketDataConfigured: kiteConfigured(),
    message: kiteConfigured()
      ? "Live Kite market data is configured; signals are generated on completed 15-minute candles. Orders are never placed by this app — execute manually."
      : "Kite credentials are not configured. Set KITE_API_KEY and KITE_ACCESS_TOKEN in .env (see docs/KITE_SETUP.md).",
  });
});

app.get("/api/signals", (_req, res) => {
  res.json({ signals: signalStore.all() });
});

app.get("/api/status", (_req, res) => {
  res.json(engine.status());
});

app.post("/api/signals/:id/close", requireLocalToken, (req, res) => {
  const closed = engine.closeSignal(String(req.params.id ?? ""));
  return closed
    ? res.json({ ok: true, message: "Signal marked closed. The open-recommendation slot is freed for the next signal." })
    : res.status(404).json({ error: "Signal not found." });
});

app.get("/callback", (req, res) => {
  const requestToken = typeof req.query.request_token === "string" ? req.query.request_token : "";
  res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><title>Kite login</title>
<style>body{font-family:Segoe UI,Arial;max-width:520px;margin:60px auto;padding:0 20px;color:#e5edf8;background:#0b1220}
.card{background:#121e31;border:1px solid #26364e;border-radius:14px;padding:24px}
button{background:#20c997;border:0;color:#04241c;font-weight:700;padding:12px 20px;border-radius:8px;cursor:pointer;font-size:15px}
code{color:#c4b5fd;word-break:break-all}.muted{color:#94a3b8}</style></head><body><div class="card">
<h2>Kite Connect login</h2>
${requestToken
  ? `<p>Request token received. Click below to exchange it for today's access token.</p>
     <p class="muted">Token: <code>${requestToken.replace(/[<>&"]/g, "")}</code></p>
     <button onclick="exchange()">Complete login</button><div id="result" style="margin-top:14px"></div>
     <script>
     async function exchange(){
       const r = await fetch('/api/kite/callback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({request_token:${JSON.stringify(requestToken).replace(/</g, "\\u003c")}})});
       const j = await r.json();
       document.getElementById('result').innerHTML = j.ok
         ? '<p style="color:#20c997">Login successful ('+j.userId+'). Access token saved — you can close this page.</p>'
         : '<p style="color:#fb7185">Failed: '+j.error+'</p>';
     }
     </script>`
  : `<p class="muted">No request_token in URL. Log in via the Kite Connect URL first.</p>`}
</div></body></html>`);
});

app.post("/api/kite/callback", express.json(), async (req, res) => {
  const requestToken = typeof req.body?.request_token === "string" ? req.body.request_token.trim() : "";
  if (!requestToken) return res.status(400).json({ ok: false, error: "Missing request_token." });
  const result = await engine.exchangeRequestToken(requestToken);
  return res.status(result.ok ? 200 : 400).json(result);
});

app.listen(env.PORT, env.HOST, () => {
  console.log(`TradePulse Precision 15 listening at http://${env.HOST}:${env.PORT}`);
  console.log(`Mode=${env.TRADING_MODE}; liveOrders=${isLiveOrderEnabled}; capitalConfigured=${capitalConfigured}; kiteConfigured=${kiteConfigured}`);
  engine.start();
  console.log("Signal engine started (polling completed 15-minute candles; no orders are ever placed).");
  if (env.APP_LOCAL_ACCESS_TOKEN === "change-this-to-a-long-random-value") {
    console.warn("WARNING: APP_LOCAL_ACCESS_TOKEN is still the default value. Set a long random value in .env before real use.");
  }
});
