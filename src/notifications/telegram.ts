export interface TelegramConfig {
  botToken?: string;
  chatId?: string;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

/** Sends outbound alerts only. It does not receive approvals or place broker orders. */
export class TelegramNotifier {
  constructor(private readonly config: TelegramConfig) {}

  get isConfigured(): boolean {
    return Boolean(this.config.botToken && this.config.chatId);
  }

  async send(message: string): Promise<void> {
    if (!this.config.botToken || !this.config.chatId) {
      throw new Error("Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.");
    }
    if (!message.trim()) throw new Error("Telegram message cannot be empty.");

    const response = await fetch(`https://api.telegram.org/bot${this.config.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: this.config.chatId,
        text: message,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    let payload: TelegramApiResponse<unknown>;
    try {
      payload = await response.json() as TelegramApiResponse<unknown>;
    } catch {
      throw new Error(`Telegram returned a non-JSON response (HTTP ${response.status}).`);
    }

    if (!response.ok || !payload.ok) {
      throw new Error(`Telegram notification failed: ${payload.description ?? `HTTP ${response.status}`}`);
    }
  }

  async getUpdates(offset?: number, timeoutSeconds = 0): Promise<TelegramUpdate[]> {
    if (!this.config.botToken) {
      throw new Error("Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.");
    }
    const params = new URLSearchParams({ timeout: String(timeoutSeconds) });
    if (offset != null) params.set("offset", String(offset));
    const response = await fetch(`https://api.telegram.org/bot${this.config.botToken}/getUpdates?${params}`, {
      signal: AbortSignal.timeout(35_000),
    });
    const payload = await response.json() as TelegramApiResponse<TelegramUpdate[]>;
    if (!response.ok || !payload.ok) {
      throw new Error(`Telegram getUpdates failed: ${payload.description ?? `HTTP ${response.status}`}`);
    }
    return payload.result ?? [];
  }
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number | string };
    date: number;
  };
}
