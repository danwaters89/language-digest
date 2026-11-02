export type ChatMessage = { role: "user" | "assistant"; content: string };

export type LlmUsage = { promptTokens: number; completionTokens: number; totalTokens: number };

export type LlmRequest = { system: string; messages: ChatMessage[] };

export type LlmResponse = { text: string; usage?: LlmUsage };

/** Provider-agnostic interface: implement this to add another provider. */
export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export type OpenAiClientOptions = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/** OpenAI-compatible /chat/completions client (works with any compatible base URL). */
export class OpenAiCompatibleClient implements LlmClient {
  private readonly baseUrl: string;
  constructor(private readonly opts: OpenAiClientOptions) {
    this.baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 120_000);
    try {
      const res = await doFetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({
          model: this.opts.model,
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: req.system }, ...req.messages],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`LLM request failed: HTTP ${res.status} ${body.slice(0, 300)}`);
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const text = json.choices?.[0]?.message?.content;
      if (typeof text !== "string") throw new Error("LLM response had no message content");
      const u = json.usage;
      return {
        text,
        usage: u
          ? {
              promptTokens: u.prompt_tokens ?? 0,
              completionTokens: u.completion_tokens ?? 0,
              totalTokens: u.total_tokens ?? 0,
            }
          : undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export type AnthropicClientOptions = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
};

/** Strip a surrounding ```json ... ``` fence if present. */
export function stripJsonFences(text: string): string {
  const m = text.trim().match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return m ? m[1].trim() : text.trim();
}

/** Anthropic Messages API client. */
export class AnthropicClient implements LlmClient {
  private readonly baseUrl: string;
  constructor(private readonly opts: AnthropicClientOptions) {
    this.baseUrl = (opts.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 120_000);
    try {
      const res = await doFetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": this.opts.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.opts.model,
          max_tokens: this.opts.maxTokens ?? 8192,
          temperature: 0.3,
          system: req.system,
          messages: req.messages,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`LLM request failed: HTTP ${res.status} ${body.slice(0, 300)}`);
      }
      const json = (await res.json()) as {
        content?: { type?: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const raw = (json.content ?? [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("");
      if (!raw) throw new Error("LLM response had no text content");
      const u = json.usage;
      const input = u?.input_tokens ?? 0;
      const output = u?.output_tokens ?? 0;
      return {
        text: stripJsonFences(raw),
        usage: u ? { promptTokens: input, completionTokens: output, totalTokens: input + output } : undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export type Provider = "anthropic" | "openai";

export function createClientFromEnv(
  model: string,
  env: NodeJS.ProcessEnv = process.env,
  provider: Provider = "anthropic",
): LlmClient {
  const apiKey = env.LLM_API_KEY;
  if (!apiKey) throw new Error("LLM_API_KEY is not set");
  const baseUrl = env.LLM_BASE_URL || undefined;
  if (provider === "openai") return new OpenAiCompatibleClient({ apiKey, model, baseUrl });
  return new AnthropicClient({ apiKey, model, baseUrl });
}
