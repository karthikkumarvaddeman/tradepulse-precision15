# Telegram setup (Windows local PC)

TradePulse uses Telegram for **outbound signal alerts**. In this starter, approval remains in the local dashboard; Telegram messages do not approve or place orders. This keeps a forwarded or tapped notification from being mistaken for broker authorization.

## 1. Create a bot

1. Open Telegram and search for the official `@BotFather`.
2. Send `/newbot`.
3. Choose a display name, e.g. `TradePulse Alerts`.
4. Choose a unique username ending in `bot`, e.g. `TradePulsePrecisionBot`.
5. Copy the token BotFather returns. Treat it like a password. Anyone with it can control your bot.

Official guide: https://core.telegram.org/bots/features#botfather

## 2. Start a private chat

1. Open your new bot using the link BotFather provides.
2. Press **Start**.
3. Send `/start`, then send one ordinary message such as `hello`.

A bot cannot start a private conversation with you; you must open it and send a message first. Use a private chat rather than a public group for the first setup.

## 3. Add the token to `.env`

In PowerShell, from the project folder:

```powershell
Copy-Item .env.example .env
notepad .env
```

Set:

```dotenv
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=123456789:replace_with_your_real_bot_token
TELEGRAM_CHAT_ID=
```

Do not include quotes unless your token/chat ID actually contains them. Do not commit `.env` or paste the token into Devin. The `.gitignore` already excludes `.env`.

## 4. Retrieve your chat ID

After sending `/start` and `hello` to your bot, run:

```powershell
npm run telegram:setup
```

The helper validates the bot token and displays private chat IDs found in recent messages. Copy the correct numeric ID into `TELEGRAM_CHAT_ID` in `.env`, save the file, and close Notepad.

Run this helper before starting another process that polls the same bot. If it says a webhook is configured, remove that webhook before using `getUpdates`; Telegram does not allow webhook delivery and long polling to be active at the same time. This project uses the helper only for setup and uses outbound `sendMessage` for alerts.

## 5. Send a test alert

```powershell
npm run telegram:test
```

You should receive a message saying Telegram alerts are connected. No trading order is placed by this test.

## 6. Start TradePulse

```powershell
npm run dev
```

The app should send Telegram messages when Devin connects the signal event pipeline to `TelegramNotifier`. Check the dashboard for approval. The current scaffold does not implement Telegram callback buttons or Telegram-based order approval.

## Troubleshooting

- **Bot not found:** verify the bot username from BotFather.
- **Chat not found / no private chat listed:** press Start, send `/start`, then send another message and rerun `npm run telegram:setup`.
- **401 Unauthorized:** token is wrong or has been revoked. Create a new token with BotFather and update `.env`.
- **403 Forbidden:** you have not started the bot, blocked it, or the bot cannot message that chat. Open the bot and press Start.
- **getUpdates conflict / webhook configured:** another process may be polling or a webhook may be set. Stop other pollers; inspect `getWebhookInfo` and remove the webhook if this is intended to be a local long-polling setup.
- **No messages:** verify `TELEGRAM_ENABLED=true`, token, chat ID, network access and application logs.

## Security

- Never share `TELEGRAM_BOT_TOKEN`. If exposed, revoke/regenerate it with BotFather immediately.
- Keep the bot in a private chat.
- Do not put API secrets or trading credentials in Telegram.
- Telegram is an alert channel only in this starter. A future Telegram approval feature must validate the sender's numeric Telegram user ID, use single-use expiring approval records, bind approval to the exact option contract/quantity/limit price, and re-run all risk checks.

## Official Telegram references

- Bot creation / BotFather: https://core.telegram.org/bots/features#botfather
- Bot API: https://core.telegram.org/bots/api
- Bot FAQ (long polling vs webhooks): https://core.telegram.org/bots/faq
