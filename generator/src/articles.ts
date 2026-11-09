import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import type { FeedItem, FetchLike } from "./feeds";

/** Max characters of article text kept per story (keeps the LLM prompt bounded). */
export const MAX_ARTICLE_CHARS = 6000;
/** Extracted text shorter than this is treated as a failed extraction (paywall, stub, video page...). */
export const MIN_ARTICLE_CHARS = 400;

/** Whole-block UI leftovers that Readability sometimes keeps (lazy-load placeholders, caption toggles, ad labels). */
const BOILERPLATE_BLOCK = /^(loading\.*|advertisement|sponsor(ed)?( message)?|.*\b(hide|toggle) caption)$/i;

/** Short photo-credit lines like "Alex Wong/Getty Images". */
const PHOTO_CREDIT = /^[^!?]{2,80}\/\s*(getty images|ap|afp|reuters|epa|npr|bbc|shutterstock|pool)\b[^!?]{0,30}$/i;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Cut text to `max` chars, preferring a paragraph boundary, then a sentence/word boundary. */
function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const para = slice.lastIndexOf("\n\n");
  if (para >= max * 0.6) return slice.slice(0, para).trim();
  const sentence = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("? "), slice.lastIndexOf("! "));
  if (sentence >= max * 0.6) return slice.slice(0, sentence + 1).trim();
  const space = slice.lastIndexOf(" ");
  return (space > 0 ? slice.slice(0, space) : slice).trim();
}

/** Extract the main article text from HTML: paragraphs joined by blank lines, whitespace collapsed, capped. */
export function extractArticleText(html: string, url: string, maxChars = MAX_ARTICLE_CHARS): string {
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  const article = new Readability(dom.window.document).parse();
  if (!article?.content) return "";

  const body = new JSDOM(article.content).window.document;
  body.querySelectorAll('figure, figcaption, aside, [class*="caption"], [class*="credit"]').forEach((el) => el.remove());
  const blocks = [...body.querySelectorAll("p, h2, h3, h4, li, blockquote")]
    // skip blocks that merely wrap other blocks; their children are collected individually
    .filter((el) => !el.querySelector("p, li, blockquote"))
    .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 0 && !BOILERPLATE_BLOCK.test(t) && !PHOTO_CREDIT.test(t));

  const text = blocks.length > 0 ? blocks.join("\n\n") : (article.textContent ?? "").replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n\n").trim();
  return capText(text, maxChars);
}

export async function fetchArticleText(
  url: string,
  opts: { timeoutMs?: number; fetchImpl?: FetchLike; maxChars?: number } = {},
): Promise<string> {
  const { timeoutMs = 15_000, fetchImpl = fetch as unknown as FetchLike, maxChars = MAX_ARTICLE_CHARS } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": "spanish-digest/0.1 (+personal learning tool)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return extractArticleText(await res.text(), url, maxChars);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch full article text for the given items in parallel. Never throws: on any failure or
 * too-short text the item is returned unchanged (the RSS summary is used instead).
 */
export async function enrichWithArticles(
  items: FeedItem[],
  opts: { timeoutMs?: number; fetchImpl?: FetchLike; maxChars?: number; minChars?: number } = {},
): Promise<FeedItem[]> {
  const minChars = opts.minChars ?? MIN_ARTICLE_CHARS;
  return Promise.all(
    items.map(async (item) => {
      try {
        const text = await fetchArticleText(item.link, opts);
        if (text.length < minChars) {
          console.warn(`[articles] ${item.link}: extracted text too short (${text.length} chars), using RSS summary`);
          return item;
        }
        return { ...item, fullText: text };
      } catch (err) {
        console.warn(`[articles] ${item.link}: failed (${errMsg(err)}), using RSS summary`);
        return item;
      }
    }),
  );
}
