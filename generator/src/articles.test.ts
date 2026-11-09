import { describe, expect, it, vi } from "vitest";
import { MAX_ARTICLE_CHARS, enrichWithArticles, extractArticleText, fetchArticleText } from "./articles";
import type { FeedItem } from "./feeds";

const para = (n: number) =>
  `Paragraph ${n} says that officials announced a new plan on Tuesday, and residents said they were cautiously optimistic about the changes.`;

const html = (paragraphs: string[]) => `<!doctype html><html><head><title>Story</title></head><body>
  <nav><a href="/">Home</a><a href="/world">World</a></nav>
  <article><h1>Big story</h1>${paragraphs.map((p) => `<p>${p}</p>`).join("\n")}</article>
  <footer>Copyright Example Media. Subscribe to our newsletter.</footer>
</body></html>`;

const longBody = Array.from({ length: 8 }, (_, i) => para(i + 1));

const okFetch = (body: string) => async () => ({ ok: true, status: 200, text: async () => body });

const item = (link: string): FeedItem => ({
  title: "T",
  summary: "RSS summary",
  link,
  source: "S",
  publishedAt: "2026-11-02T10:00:00.000Z",
});

describe("extractArticleText", () => {
  it("returns paragraphs separated by blank lines without boilerplate", () => {
    const text = extractArticleText(html(longBody), "https://example.com/a");
    expect(text.split("\n\n").length).toBeGreaterThanOrEqual(8);
    expect(text).toContain("Paragraph 1 says");
    expect(text).not.toContain("Subscribe to our newsletter");
  });

  it("caps length at a paragraph boundary", () => {
    const many = Array.from({ length: 80 }, (_, i) => para(i + 1));
    const text = extractArticleText(html(many), "https://example.com/a");
    expect(text.length).toBeLessThanOrEqual(MAX_ARTICLE_CHARS);
    expect(text.endsWith(".")).toBe(true);
  });
});

describe("fetchArticleText", () => {
  it("throws on HTTP errors", async () => {
    const f = async () => ({ ok: false, status: 404, text: async () => "" });
    await expect(fetchArticleText("https://example.com/a", { fetchImpl: f })).rejects.toThrow("HTTP 404");
  });
});

describe("enrichWithArticles", () => {
  it("adds fullText on success", async () => {
    const [out] = await enrichWithArticles([item("https://example.com/a")], { fetchImpl: okFetch(html(longBody)) });
    expect(out.fullText).toContain("Paragraph 1 says");
    expect(out.summary).toBe("RSS summary");
  });

  it("falls back to the summary when text is too short", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [out] = await enrichWithArticles([item("https://example.com/short")], {
      fetchImpl: okFetch(html(["Just one short paragraph."])),
    });
    expect(out.fullText).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("https://example.com/short"));
    warn.mockRestore();
  });

  it("falls back without throwing when the fetch fails, keeping other items", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = async (url: string) => {
      if (url.includes("bad")) throw new Error("network down");
      return { ok: true, status: 200, text: async () => html(longBody) };
    };
    const out = await enrichWithArticles([item("https://example.com/bad"), item("https://example.com/good")], { fetchImpl });
    expect(out[0].fullText).toBeUndefined();
    expect(out[1].fullText).toBeDefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("https://example.com/bad"));
    warn.mockRestore();
  });
});
