import type { FeedItem } from "./feeds";

/** Round-robin across sources (in order of first appearance), newest first within each. */
export function selectStories(items: FeedItem[], maxStories: number): FeedItem[] {
  const bySource = new Map<string, FeedItem[]>();
  for (const item of items) {
    const list = bySource.get(item.source) ?? [];
    list.push(item);
    bySource.set(item.source, list);
  }
  const queues = [...bySource.values()].map((q) =>
    [...q].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
  );
  const out: FeedItem[] = [];
  while (out.length < maxStories && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      const next = q.shift();
      if (next && out.length < maxStories) out.push(next);
    }
  }
  return out;
}
