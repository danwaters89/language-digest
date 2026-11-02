import { describe, expect, it, vi } from "vitest";
import { AnthropicClient, stripJsonFences } from "./llm";

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
}

const req = { system: "sys", messages: [{ role: "user" as const, content: "hi" }] };

describe("AnthropicClient", () => {
  it("returns text and usage and sends correct request", async () => {
    const f = mockFetch(200, {
      content: [{ type: "text", text: '{"a":1}' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const c = new AnthropicClient({ apiKey: "k", model: "m", fetchImpl: f as unknown as typeof fetch });
    const r = await c.complete(req);
    expect(r.text).toBe('{"a":1}');
    expect(r.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("k");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe("sys");
    expect(body.max_tokens).toBeGreaterThanOrEqual(8192);
    expect(body.messages).toEqual(req.messages);
  });

  it("strips ```json fences", async () => {
    const f = mockFetch(200, { content: [{ type: "text", text: '```json\n{"a":1}\n```' }] });
    const c = new AnthropicClient({ apiKey: "k", model: "m", fetchImpl: f as unknown as typeof fetch });
    const r = await c.complete(req);
    expect(r.text).toBe('{"a":1}');
    expect(r.usage).toBeUndefined();
  });

  it("throws on HTTP error", async () => {
    const f = mockFetch(401, "bad key");
    const c = new AnthropicClient({ apiKey: "k", model: "m", fetchImpl: f as unknown as typeof fetch });
    await expect(c.complete(req)).rejects.toThrow(/HTTP 401/);
  });
});

describe("stripJsonFences", () => {
  it("leaves plain JSON alone", () => {
    expect(stripJsonFences(' {"a":1} ')).toBe('{"a":1}');
  });
});
