import { describe, expect, it } from "vitest";
import { allSurfacesPresent, matchGlosses, repairGlosses } from "./gloss-match";

const g = (surface: string, lemma = surface) => ({ surface, lemma, en: "x" });

describe("allSurfacesPresent", () => {
  it("is true when every surface is a whole word in the sentence (case-insensitive)", () => {
    expect(allSurfacesPresent("Los líderes hablan.", [g("líderes"), g("HABLAN")])).toBe(true);
  });

  it("is false for missing words and partial-word matches", () => {
    expect(allSurfacesPresent("Los líderes hablan.", [g("lider")])).toBe(false);
    expect(allSurfacesPresent("Los líderes hablan.", [g("habla")])).toBe(false);
  });

  it("requires a separate occurrence for duplicate glosses", () => {
    expect(allSurfacesPresent("casa bonita", [g("casa"), g("casa")])).toBe(false);
    expect(allSurfacesPresent("casa y casa", [g("casa"), g("casa")])).toBe(true);
  });
});

describe("repairGlosses", () => {
  it("keeps valid glosses, drops unfixable ones, repairs via trim or lemma", () => {
    const es = "El alcalde dice que la obra costó mucho.";
    const r = repairGlosses(es, [
      g("alcalde"),
      g(" obra "),
      g("costaron", "costó"),
      g("inexistente"),
    ]);
    expect(r.words.map((w) => w.surface)).toEqual(["alcalde", "obra", "costó"]);
    expect(r.dropped.map((w) => w.surface)).toEqual(["inexistente"]);
    expect(r.repaired).toHaveLength(2);
  });
});

describe("matchGlosses", () => {
  it("splits into plain and glossed segments in order", () => {
    const segs = matchGlosses("El puente cruza un río.", [g("cruza"), g("puente")]);
    expect(segs.map((s) => s.text).join("")).toBe("El puente cruza un río.");
    expect(segs.filter((s) => s.gloss).map((s) => s.text)).toEqual(["puente", "cruza"]);
  });

  it("preserves original casing of the sentence text", () => {
    const segs = matchGlosses("Tierra y tierra", [g("tierra")]);
    expect(segs[0]).toEqual({ text: "Tierra", gloss: expect.objectContaining({ surface: "tierra" }) });
  });

  it("uses the first unmatched occurrence for repeated surfaces", () => {
    const segs = matchGlosses("casa y casa", [g("casa", "a"), g("casa", "b")]);
    const glossed = segs.filter((s) => s.gloss);
    expect(glossed.map((s) => s.gloss?.lemma)).toEqual(["a", "b"]);
  });

  it("does not match inside longer words and ignores unmatched glosses", () => {
    const segs = matchGlosses("Los autos", [g("auto"), g("nada")]);
    expect(segs).toEqual([{ text: "Los autos" }]);
  });
});
