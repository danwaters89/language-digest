import type { FeedItem } from "./feeds";
import { llmOutputJsonSchema, type Config } from "./schema";

export function buildSystemPrompt(config: Pick<Config, "level" | "spanishVariant" | "targetSentencesPerStory">): string {
  const { level, spanishVariant, targetSentencesPerStory } = config;
  return [
    `You are writing a daily news digest for a Spanish learner at CEFR level ${level}, using ${spanishVariant} vocabulary and spelling.`,
    "",
    "Rules:",
    `- For each provided story, write an original summary of ${targetSentencesPerStory} short sentences covering the main points of the story's \`text\` (which may be a full article or just a short blurb). Do not copy phrasing from the source text.`,
    `- Spanish must match level ${level}: short sentences, common vocabulary, mostly present tense plus simple past at A2, avoid subjunctive below B1, avoid idioms unless glossed.`,
    "- For each sentence, provide a faithful English translation.",
    `- For each sentence, list glosses only for words a ${level} learner would probably not know. Include the lemma, and keep glosses short and specific to the sentence's meaning. Do not gloss articles, pronouns, or very common words.`,
    "- Each gloss `surface` must appear EXACTLY as written (same spelling and accents) as a whole word inside that sentence's `es` text.",
    "- Keep tone neutral and factual. Do not add facts that are not in the provided material.",
    "- Also write a short Spanish headline (`headline.es`) and English headline (`headline.en`) for each story.",
    "- Set `sourceIndex` to the index of the provided story you are summarizing. Produce one entry per provided story.",
    "- Respond with JSON only, matching the JSON schema below. No markdown fences, no commentary.",
    "",
    "JSON schema:",
    JSON.stringify(llmOutputJsonSchema()),
  ].join("\n");
}

/** Only titles, article text (full text if fetched, else the RSS summary), and links are sent to the model. */
export function buildUserPrompt(items: FeedItem[]): string {
  const stories = items.map((item, sourceIndex) => ({
    sourceIndex,
    source: item.source,
    title: item.title,
    text: item.fullText ?? item.summary,
    link: item.link,
  }));
  return `Stories to summarize:\n${JSON.stringify(stories, null, 2)}`;
}

export function buildRetryPrompt(errors: string[]): string {
  return [
    "Your previous response was invalid. Fix these problems and respond again with the complete corrected JSON only:",
    ...errors.map((e) => `- ${e}`),
  ].join("\n");
}
