const LINE_REPLY_ENDPOINT = "https://api.line.me/v2/bot/message/reply";

export interface LineReplyApiOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class LineReplyApiError extends Error {
  readonly status: number | null;
  readonly code: "http" | "network" | "timeout";

  constructor(message: string, code: LineReplyApiError["code"], status: number | null = null) {
    super(message);
    this.name = "LineReplyApiError";
    this.code = code;
    this.status = status;
  }
}

export class LineReplyApiClient {
  private readonly accessToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(accessToken: string, options: LineReplyApiOptions = {}) {
    this.accessToken = accessToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async reply(replyToken: string, text: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(LINE_REPLY_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) throw new LineReplyApiError("LINE Reply API request timed out.", "timeout");
        throw new LineReplyApiError("LINE Reply API request failed.", "network");
      }
      if (!response.ok) throw new LineReplyApiError(`LINE Reply API returned HTTP ${response.status}.`, "http", response.status);
    } finally {
      clearTimeout(timer);
    }
  }
}
