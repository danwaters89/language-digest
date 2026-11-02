import { describe, expect, it } from "vitest";
import { dedupe, fetchAllFeeds, filterRecent, parseFeed, titleSimilarity, type FeedItem } from "./feeds";
import { selectStories } from "./select";

const item = (title: string, source = "A", publishedAt = "2026-11-02T10:00:00.000Z"): FeedItem => ({
  title,
  summary: "",
  link: `https://example.com/${encodeURIComponent(title)}`,
  source,
  publishedAt,
});

describe("dedupe", () => {
  it("removes near-identical titles across feeds, keeping the first", () => {
    const out = dedupe([
      item("Israel and Hamas agree to ceasefire deal", "BBC"),
      item("Hamas, Israel agree ceasefire deal", "NPR"),
      item("Storm hits Florida coast", "NPR"),
    ]);
    expect(out.map((i) => i.title)).toEqual(["Israel and Hamas agree to ceasefire deal", "Storm hits Florida coast"]);
  });

  it("keeps unrelated titles and is accent/case/punctuation insensitive", () => {
    expect(titleSimilarity("Café: Prices Rise!", "cafe prices rise")).toBe(1);
    expect(titleSimilarity("Storm hits Florida coast", "Local team wins championship")).toBeLessThan(0.2);
  });
});

describe("parseFeed / filterRecent", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>Fresh &amp; new</title><description><![CDATA[<p>Hello <b>world</b></p>]]></description>
      <link>https://e.com/1</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate></item>
    <item><title>Old one</title><link>https://e.com/2</link><pubDate>Fri, 30 Oct 2026 10:00:00 GMT</pubDate></item>
    <item><title>No date</title><link>https://e.com/3</link></item>
  </channel></rss>`;

  it("normalizes RSS items and drops undated ones", () => {
    const items = parseFeed(xml, "Src");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "Fresh & new", summary: "Hello world", link: "https://e.com/1", source: "Src" });
  });

  it("drops items older than 36 hours", () => {
    const now = new Date("2026-11-02T12:00:00Z");
    const recent = filterRecent(parseFeed(xml, "Src"), now);
    expect(recent.map((i) => i.title)).toEqual(["Fresh & new"]);
  });
});

describe("fetchAllFeeds", () => {
  const rss = `<rss><channel><item><title>T</title><link>https://e.com/1</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
  const now = new Date("2026-11-02T12:00:00Z");

  it("skips failed feeds but succeeds if one works", async () => {
    const fetchImpl = async (url: string) =>
      url.includes("bad") ? { ok: false, status: 500, text: async () => "" } : { ok: true, status: 200, text: async () => rss };
    const items = await fetchAllFeeds(
      [{ name: "Good", url: "https://good" }, { name: "Bad", url: "https://bad" }],
      { now, fetchImpl },
    );
    expect(items).toHaveLength(1);
  });

  it("fails when all feeds fail", async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, text: async () => "" });
    await expect(fetchAllFeeds([{ name: "Bad", url: "https://bad" }], { now, fetchImpl })).rejects.toThrow(/All feeds failed/);
  });
});

describe("selectStories", () => {
  it("round-robins across sources up to the max", () => {
    const items = [item("a1", "A"), item("a2", "A"), item("a3", "A"), item("b1", "B"), item("b2", "B")];
    expect(selectStories(items, 4).map((i) => i.title)).toEqual(["a1", "b1", "a2", "b2"]);
  });
});
