import { XMLParser } from "fast-xml-parser";

export type FeedConfig = { name: string; url: string };

export type FeedItem = {
  title: string;
  summary: string;
  link: string;
  source: string;
  publishedAt: string; // ISO
  /** Full article text (set by enrichWithArticles); preferred over `summary` in the LLM prompt. */
  fullText?: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && "#text" in v) return textOf((v as Record<string, unknown>)["#text"]);
  return "";
}

export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function linkOf(v: unknown): string {
  for (const l of asArray(v as unknown)) {
    if (typeof l === "string") return l.trim();
    if (l && typeof l === "object") {
      const href = (l as Record<string, unknown>)["@_href"];
      if (typeof href === "string") return href.trim();
      const t = textOf(l).trim();
      if (t) return t;
    }
  }
  return "";
}

/** Parse RSS 2.0 or Atom XML into normalized items. Items with unusable dates are dropped. */
export function parseFeed(xml: string, source: string): FeedItem[] {
  const doc = parser.parse(xml) as Record<string, any>;
  const rawItems: Record<string, unknown>[] = doc?.rss?.channel
    ? asArray(doc.rss.channel.item)
    : asArray(doc?.feed?.entry);

  const items: FeedItem[] = [];
  for (const raw of rawItems) {
    const title = stripHtml(textOf(raw.title));
    const link = linkOf(raw.link);
    const summary = stripHtml(textOf(raw.description ?? raw.summary ?? raw.content)).slice(0, 600);
    const dateStr = textOf(raw.pubDate ?? raw.published ?? raw.updated ?? raw["dc:date"]);
    const t = Date.parse(dateStr);
    if (!title || !link || Number.isNaN(t)) continue;
    items.push({ title, summary, link, source, publishedAt: new Date(t).toISOString() });
  }
  return items;
}

export function filterRecent(items: FeedItem[], now: Date, maxAgeHours = 36): FeedItem[] {
  const cutoff = now.getTime() - maxAgeHours * 3600_000;
  return items.filter((i) => Date.parse(i.publishedAt) >= cutoff);
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "after", "over", "into", "are", "was", "has", "have",
  "says", "say", "will", "its", "his", "her", "their", "new", "not", "but", "you", "your",
]);

function titleTokens(title: string): Set<string> {
  const norm = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ");
  return new Set(norm.split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w)));
}

export function titleSimilarity(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Drop near-identical titles (Jaccard similarity of normalized tokens); first occurrence wins. */
export function dedupe(items: FeedItem[], threshold = 0.4): FeedItem[] {
  const kept: FeedItem[] = [];
  for (const item of items) {
    if (!kept.some((k) => titleSimilarity(k.title, item.title) >= threshold)) kept.push(item);
  }
  return kept;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export async function fetchFeedXml(
  url: string,
  opts: { timeoutMs?: number; retries?: number; fetchImpl?: FetchLike } = {},
): Promise<string> {
  const { timeoutMs = 10_000, retries = 1, fetchImpl = fetch as unknown as FetchLike } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        signal: ctrl.signal,
        headers: { "user-agent": "spanish-digest/0.1 (+personal learning tool)" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) console.warn(`[feeds] ${url} failed (${errMsg(err)}), retrying`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Fetch all feeds in parallel. Failed feeds are skipped; throws only if every feed fails. */
export async function fetchAllFeeds(
  feeds: FeedConfig[],
  opts: { now?: Date; fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<FeedItem[]> {
  const now = opts.now ?? new Date();
  const results = await Promise.all(
    feeds.map(async (feed) => {
      try {
        const xml = await fetchFeedXml(feed.url, opts);
        const all = parseFeed(xml, feed.name);
        const recent = filterRecent(all, now).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
        console.log(`[feeds] ${feed.name}: ${all.length} items, ${recent.length} within 36h`);
        return { ok: true as const, items: recent };
      } catch (err) {
        console.error(`[feeds] ${feed.name}: FAILED (${errMsg(err)}), skipping`);
        return { ok: false as const, items: [] as FeedItem[] };
      }
    }),
  );
  if (results.every((r) => !r.ok)) throw new Error("All feeds failed");
  return results.flatMap((r) => r.items);
}
