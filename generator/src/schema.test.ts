import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DigestSchema, IndexSchema, LlmOutputSchema, llmOutputJsonSchema } from "./schema";
import { allSurfacesPresent } from "./gloss-match";
import { parseLlmText } from "./index";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/digest.json", import.meta.url), "utf8"));

describe("DigestSchema", () => {
  it("accepts the fixture digest", () => {
    expect(DigestSchema.safeParse(fixture).success).toBe(true);
  });

  it("every fixture gloss surface occurs in its sentence", () => {
    for (const story of fixture.stories) {
      for (const s of story.sentences) expect(allSurfacesPresent(s.es, s.words)).toBe(true);
    }
  });

  it("rejects a bad date and missing fields", () => {
    expect(DigestSchema.safeParse({ ...fixture, date: "11/02/2026" }).success).toBe(false);
    const bad = structuredClone(fixture);
    delete bad.stories[0].sentences[0].en;
    expect(DigestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an empty story list", () => {
    expect(DigestSchema.safeParse({ ...fixture, stories: [] }).success).toBe(false);
  });
});

describe("IndexSchema", () => {
  it("validates index shape", () => {
    expect(IndexSchema.safeParse({ latest: "2026-11-03", dates: ["2026-11-03", "2026-11-02"] }).success).toBe(true);
    expect(IndexSchema.safeParse({ latest: "x", dates: [] }).success).toBe(false);
  });
});

describe("LLM output", () => {
  it("produces a JSON schema for the prompt", () => {
    expect(JSON.stringify(llmOutputJsonSchema())).toContain("sourceIndex");
  });

  const valid = {
    stories: [
      {
        sourceIndex: 0,
        headline: { es: "Hola", en: "Hello" },
        sentences: [{ es: "Hola mundo.", en: "Hello world.", words: [] }],
      },
    ],
  };

  it("parses valid text, including fenced JSON", () => {
    expect(LlmOutputSchema.safeParse(valid).success).toBe(true);
    expect(parseLlmText(JSON.stringify(valid), 1).ok).toBe(true);
    expect(parseLlmText("```json\n" + JSON.stringify(valid) + "\n```", 1).ok).toBe(true);
  });

  it("reports errors for non-JSON, schema violations, and out-of-range indexes", () => {
    expect(parseLlmText("nope", 1).ok).toBe(false);
    expect(parseLlmText(JSON.stringify({ stories: [{ sourceIndex: 0 }] }), 1).ok).toBe(false);
    const r = parseLlmText(JSON.stringify(valid), 0);
    expect(r.ok).toBe(false);
  });
});
