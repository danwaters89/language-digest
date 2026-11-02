import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllFeeds, dedupe, type FeedItem } from "./feeds";
import { repairGlosses } from "./gloss-match";
import { createClientFromEnv, type ChatMessage, type LlmClient, type LlmUsage } from "./llm";
import { buildRetryPrompt, buildSystemPrompt, buildUserPrompt } from "./prompt";
import {
  ConfigSchema,
  DigestSchema,
  LlmOutputSchema,
  type Config,
  type Digest,
  type LlmOutput,
  type Story,
} from "./schema";
import { selectStories } from "./select";
import { writeDigest } from "./write";

const generatorDir = fileURLToPath(new URL("..", import.meta.url));
const defaultOutDir = path.resolve(generatorDir, "../web/public/digests");
const fixturePath = path.resolve(generatorDir, "fixtures/digest.json");

/** Today's date (YYYY-MM-DD) in the given IANA timezone. */
export function dateInTimezone(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Parse + validate raw LLM text. Returns output or a list of human-readable errors. */
export function parseLlmText(text: string, itemCount: number): { ok: true; output: LlmOutput } | { ok: false; errors: string[] } {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch (err) {
    return { ok: false, errors: [`Response was not valid JSON: ${(err as Error).message}`] };
  }
  const parsed = LlmOutputSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const errors: string[] = [];
  for (const [i, s] of parsed.data.stories.entries()) {
    if (s.sourceIndex >= itemCount) errors.push(`stories.${i}.sourceIndex: ${s.sourceIndex} is out of range (0-${itemCount - 1})`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, output: parsed.data };
}

/** Assemble the final digest: fill source/id, and drop or repair glosses that do not occur in their sentence. */
export function assembleDigest(output: LlmOutput, items: FeedItem[], config: Config, date: string, now: Date): Digest {
  const seen = new Set<number>();
  const stories: Story[] = [];
  let dropped = 0;
  let repaired = 0;
  for (const s of output.stories) {
    if (seen.has(s.sourceIndex)) continue;
    seen.add(s.sourceIndex);
    const item = items[s.sourceIndex];
    stories.push({
      id: `${date}-${stories.length + 1}`,
      headline: s.headline,
      source: { name: item.source, url: item.link },
      sentences: s.sentences.map((sent) => {
        const r = repairGlosses(sent.es, sent.words);
        dropped += r.dropped.length;
        repaired += r.repaired.length;
        return { ...sent, words: r.words };
      }),
    });
  }
  if (dropped || repaired) console.log(`[validate] glosses repaired: ${repaired}, dropped: ${dropped}`);
  return {
    date,
    level: config.level,
    spanishVariant: config.spanishVariant,
    generatedAt: now.toISOString(),
    stories,
  };
}

async function generateWithRetry(client: LlmClient, config: Config, items: FeedItem[]): Promise<LlmOutput> {
  const system = buildSystemPrompt(config);
  const messages: ChatMessage[] = [{ role: "user", content: buildUserPrompt(items) }];
  const total: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.complete({ system, messages });
    if (res.usage) {
      total.promptTokens += res.usage.promptTokens;
      total.completionTokens += res.usage.completionTokens;
      total.totalTokens += res.usage.totalTokens;
    }
    console.log(
      `[llm] attempt ${attempt + 1}: tokens prompt=${res.usage?.promptTokens ?? "?"} completion=${res.usage?.completionTokens ?? "?"}`,
    );
    const parsed = parseLlmText(res.text, items.length);
    if (parsed.ok) {
      console.log(`[llm] total tokens used: ${total.totalTokens}, validation retries: ${attempt}`);
      return parsed.output;
    }
    lastErrors = parsed.errors;
    console.warn(`[validate] attempt ${attempt + 1} invalid:\n  ${parsed.errors.slice(0, 10).join("\n  ")}`);
    messages.push({ role: "assistant", content: res.text }, { role: "user", content: buildRetryPrompt(parsed.errors.slice(0, 20)) });
  }
  throw new Error(`LLM output failed validation after retry: ${lastErrors.slice(0, 5).join("; ")}`);
}

async function loadConfig(): Promise<Config> {
  const raw = JSON.parse(await readFile(path.resolve(generatorDir, "config.json"), "utf8"));
  return ConfigSchema.parse(raw);
}

function parseArgs(argv: string[]) {
  const args = { dryRun: false, outDir: defaultOutDir };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--out-dir") args.outDir = path.resolve(argv[++i] ?? "");
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig();
  const now = new Date();

  let digest: Digest;
  if (args.dryRun) {
    console.log("[dry-run] using fixture digest; no feed or LLM calls");
    digest = DigestSchema.parse(JSON.parse(await readFile(fixturePath, "utf8")));
  } else {
    const all = await fetchAllFeeds(config.feeds, { now });
    const unique = dedupe(all);
    console.log(`[feeds] ${all.length} items, ${unique.length} after dedupe`);
    const items = selectStories(unique, config.maxStories);
    if (items.length === 0) throw new Error("No recent stories found");
    console.log(`[select] ${items.length} stories selected: ${items.map((i) => `"${i.title}"`).join(", ")}`);
    const client = createClientFromEnv(config.model, process.env, config.provider);
    const output = await generateWithRetry(client, config, items);
    digest = assembleDigest(output, items, config, dateInTimezone(now, config.timezone), now);
  }

  const { file, index } = await writeDigest(digest, args.outDir);
  console.log(`[write] wrote ${file} (${digest.stories.length} stories); index latest=${index.latest}, ${index.dates.length} dates`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(`[error] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
