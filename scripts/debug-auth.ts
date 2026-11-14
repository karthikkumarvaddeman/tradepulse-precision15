import { env } from "../src/config/env.js";
const creds = { apiKey: env.KITE_API_KEY ?? "", accessToken: env.KITE_ACCESS_TOKEN };
const res = await fetch("https://api.kite.trade/user/profile", { headers: { "X-Kite-Version": "3", Authorization: `token ${creds.apiKey}:${creds.accessToken}` } });
console.log("profile status:", res.status, await res.text());
