import { describe, expect, it } from "vitest";
import { matchGlosses } from "./glosses";

const gloss = (surface: string, lemma = surface) => ({ surface, lemma, en: "x" });

describe("matchGlosses (reader rule)", () => {
  it("wraps glossed words and leaves the rest as plain text", () => {
    const segs = matchGlosses("Un grupo de científicos encontró un planeta.", [
      gloss("científicos", "científico"),
      gloss("encontró", "encontrar"),
    ]);
    expect(segs).toEqual([
      { text: "Un grupo de " },
      { text: "científicos", gloss: expect.objectContaining({ lemma: "científico" }) },
      { text: " " },
      { text: "encontró", gloss: expect.objectContaining({ lemma: "encontrar" }) },
      { text: " un planeta." },
    ]);
  });

  it("matches case-insensitively and keeps sentence casing", () => {
    const [first] = matchGlosses("Tierra firme", [gloss("tierra")]);
    expect(first.text).toBe("Tierra");
    expect(first.gloss).toBeDefined();
  });

  it("matches whole words only, including accented letters", () => {
    expect(matchGlosses("reunión", [gloss("reunió")])).toEqual([{ text: "reunión" }]);
    expect(matchGlosses("la reunión", [gloss("reunión")]).some((s) => s.gloss)).toBe(true);
  });

  it("uses first unmatched occurrence for repeated surfaces", () => {
    const segs = matchGlosses("casa y casa", [gloss("casa", "uno"), gloss("casa", "dos")]);
    expect(segs.filter((s) => s.gloss).map((s) => s.gloss?.lemma)).toEqual(["uno", "dos"]);
  });

  it("renders unmatched glosses as nothing", () => {
    expect(matchGlosses("hola", [gloss("adiós")])).toEqual([{ text: "hola" }]);
  });
});
