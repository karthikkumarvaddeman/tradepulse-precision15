import "dotenv/config";

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number; type: string; title?: string; username?: string; first_name?: string };
    from?: { id: number; username?: string; first_name?: string };
    text?: string;
  };
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN. Add your BotFather token to .env first.");
  process.exit(1);
}

async function callTelegram<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json() as TelegramResponse<T>;
  if (!response.ok || !payload.ok || payload.result === undefined) {
    throw new Error(payload.description ?? `Telegram API error: HTTP ${response.status}`);
  }
  return payload.result;
}

try {
  const me = await callTelegram<{ id: number; is_bot: boolean; username?: string }>("getMe");
  console.log(`Connected to Telegram bot: @${me.username ?? "unknown"}`);

  const webhook = await callTelegram<{ url: string }>("getWebhookInfo");
  if (webhook.url) {
    console.error("This bot currently has a webhook configured. Telegram does not allow getUpdates while a webhook is active.");
    console.error("Remove the webhook in your bot integration before running this local setup helper.");
    process.exit(2);
  }

  const updates = await callTelegram<TelegramUpdate[]>("getUpdates", {
    limit: 100,
    timeout: 0,
    allowed_updates: ["message"],
  });

  const privateChats = new Map<number, { senderId?: number; label: string }>();
  for (const update of updates) {
    const message = update.message;
    if (!message?.chat || message.chat.type !== "private") continue;
    const label = message.from?.username
      ? `@${message.from.username}`
      : message.from?.first_name ?? "private chat";
    privateChats.set(message.chat.id, { senderId: message.from?.id, label });
  }

  if (privateChats.size === 0) {
    console.log("No private chat found yet.");
    console.log("Open your bot in Telegram, press Start, send /start and then send a normal message.");
    console.log("Run npm run telegram:setup again.");
    process.exit(0);
  }

  console.log("\nPrivate chats found:");
  for (const [chatId, details] of privateChats) {
    console.log(`  ${details.label}: chat ID ${chatId}; sender/user ID ${details.senderId ?? "not available"}`);
    console.log(`  Add this line to .env: TELEGRAM_CHAT_ID=${chatId}`);
  }
  console.log("\nKeep TELEGRAM_BOT_TOKEN secret. Do not paste it into Devin prompts, source files, screenshots or chat messages.");
  console.log("This helper reads pending updates; do not run it at the same time as another process polling this bot.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unknown Telegram setup error");
  process.exit(1);
}
