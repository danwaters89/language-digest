import { z } from "zod";

export const GlossSchema = z.object({
  surface: z.string().min(1),
  lemma: z.string().min(1),
  en: z.string().min(1),
  pos: z.string().optional(),
});

export const SentenceSchema = z.object({
  es: z.string().min(1),
  en: z.string().min(1),
  words: z.array(GlossSchema),
});

export const StorySchema = z.object({
  id: z.string().min(1),
  headline: z.object({ es: z.string().min(1), en: z.string().min(1) }),
  source: z.object({ name: z.string().min(1), url: z.string().url() }),
  sentences: z.array(SentenceSchema).min(1),
});

export const DigestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  level: z.string().min(1),
  spanishVariant: z.string().min(1),
  generatedAt: z.string().min(1),
  stories: z.array(StorySchema).min(1),
});

export const IndexSchema = z.object({
  latest: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1),
});

/** What the LLM is asked to produce. Source info and ids are filled in by the generator. */
export const LlmStorySchema = z.object({
  sourceIndex: z.number().int().min(0),
  headline: z.object({ es: z.string().min(1), en: z.string().min(1) }),
  sentences: z.array(SentenceSchema).min(1),
});

export const LlmOutputSchema = z.object({
  stories: z.array(LlmStorySchema).min(1),
});

export const ConfigSchema = z.object({
  level: z.enum(["A1", "A2", "B1", "B2", "C1"]),
  timezone: z.string().min(1),
  maxStories: z.number().int().positive(),
  targetSentencesPerStory: z.number().int().positive(),
  feeds: z.array(z.object({ name: z.string().min(1), url: z.string().url() })).min(1),
  spanishVariant: z.string().min(1),
  provider: z.enum(["anthropic", "openai"]).default("anthropic"),
  model: z.string().min(1),
  /** Fetch full article text for selected stories (falls back to RSS summary per story on failure). */
  fetchArticles: z.boolean().default(true),
});

export type Gloss = z.infer<typeof GlossSchema>;
export type Sentence = z.infer<typeof SentenceSchema>;
export type Story = z.infer<typeof StorySchema>;
export type Digest = z.infer<typeof DigestSchema>;
export type DigestIndex = z.infer<typeof IndexSchema>;
export type LlmOutput = z.infer<typeof LlmOutputSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export function llmOutputJsonSchema(): unknown {
  return z.toJSONSchema(LlmOutputSchema);
}
