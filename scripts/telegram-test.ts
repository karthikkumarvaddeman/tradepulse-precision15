import "dotenv/config";
import { TelegramNotifier } from "../src/notifications/telegram.js";

const notifier = new TelegramNotifier({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID,
});

try {
  await notifier.send(
    "✅ TradePulse Precision 15 Telegram test\n\n" +
    "Telegram alerts are connected. This is a test notification only; no order has been placed."
  );
  console.log("Test message sent successfully.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unknown Telegram test error");
  process.exit(1);
}
