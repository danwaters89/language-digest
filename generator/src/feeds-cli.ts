import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchArticleText } from "./articles";
import { fetchFeedXml, parseFeed } from "./feeds";

// Usage: npm run feeds -- [--raw] [--feed <name-substring>] [--articles [--limit N]]
//   (default)  print parsed items as JSON
//   --raw      print the raw XML exactly as fetched
//   --articles fetch + print extracted full article text for the first N items per feed (--limit, default 3)
const generatorDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const raw = argv.includes("--raw");
const articles = argv.includes("--articles");
const fi = argv.indexOf("--feed");
const only = fi >= 0 ? argv[fi + 1]?.toLowerCase() : undefined;
const li = argv.indexOf("--limit");
const limit = li >= 0 ? Number(argv[li + 1]) : 3;
if (!Number.isInteger(limit) || limit < 1) {
  console.error("--limit must be a positive integer");
  process.exit(1);
}

const config = JSON.parse(await readFile(path.resolve(generatorDir, "config.json"), "utf8"));
const feeds: { name: string; url: string }[] = config.feeds.filter(
  (f: { name: string }) => !only || f.name.toLowerCase().includes(only),
);

for (const feed of feeds) {
  console.log(`\n===== ${feed.name} (${feed.url}) =====`);
  try {
    const xml = await fetchFeedXml(feed.url, {});
    if (raw) {
      console.log(xml);
    } else if (articles) {
      for (const item of parseFeed(xml, feed.name).slice(0, limit)) {
        console.log(`\n--- ${item.title}\n    ${item.link}`);
        try {
          const text = await fetchArticleText(item.link);
          console.log(`    [${text.length} chars]\n`);
          console.log(text);
        } catch (err) {
          console.error(`    Article failed: ${err instanceof Error ? err.message : err}`);
        }
      }
    } else {
      console.log(JSON.stringify(parseFeed(xml, feed.name), null, 2));
    }
  } catch (err) {
    console.error(`Failed: ${err instanceof Error ? err.message : err}`);
  }
}
