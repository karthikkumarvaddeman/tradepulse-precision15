import { env } from "../src/config/env.js";
import { kiteLoginUrl, requestAccessToken } from "../src/broker/kiteClient.js";

/**
 * Daily Kite Connect login helper.
 *
 * 1. Run: npm run kite:login
 * 2. Open the printed URL, log in with your Zerodha credentials.
 * 3. Zerodha redirects to your KITE_REDIRECT_URL with ?request_token=XXXX
 * 4. Copy the request_token and run: npm run kite:token -- <request_token>
 * 5. Paste the printed access token into .env as KITE_ACCESS_TOKEN.
 *
 * Access tokens expire daily — repeat each trading morning.
 */
const requestToken = process.argv[2];

if (!env.KITE_API_KEY) {
  console.error("KITE_API_KEY is not set in .env");
  process.exit(1);
}

if (!requestToken) {
  console.log("Open this URL to log in:");
  console.log(kiteLoginUrl(env.KITE_API_KEY));
  console.log("\nAfter login you will be redirected with a request_token query param.");
  console.log("Then run: npm run kite:token -- <request_token>");
  process.exit(0);
}

if (!env.KITE_API_SECRET) {
  console.error("KITE_API_SECRET is not set in .env — required to exchange the request_token.");
  process.exit(1);
}

try {
  const result = await requestAccessToken(
    { apiKey: env.KITE_API_KEY, apiSecret: env.KITE_API_SECRET },
    requestToken,
  );
  console.log("Login successful.");
  console.log(`user_id: ${result.userId}`);
  console.log(`login_time: ${result.loginTime}`);
  console.log("\nSet this in .env (it expires daily):");
  console.log(`KITE_ACCESS_TOKEN=${result.accessToken}`);
} catch (error) {
  console.error("Token exchange failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
