import { describe, expect, it } from "vitest";
import { createStorage, SETTINGS_KEY, WORDS_KEY, type StorageLike } from "./storage";

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwing: StorageLike = {
  getItem() {
    throw new Error("denied");
  },
  setItem() {
    throw new Error("quota");
  },
  removeItem() {
    throw new Error("denied");
  },
};

const gloss = { surface: "Científicos", lemma: "científico", en: "scientist", pos: "noun" };
const sentence = { es: "Los científicos hablan.", en: "The scientists talk." };

describe("storage", () => {
  it("creates a record on first lookup", () => {
    const backend = fakeStorage();
    const s = createStorage(backend);
    const rec = s.recordLookup(gloss, sentence, "2026-11-01");
    expect(rec).toEqual({
      lemma: "científico",
      forms: ["científicos"],
      en: "scientist",
      pos: "noun",
      lookupCount: 1,
      saved: true,
      firstSeen: "2026-11-01",
      lastSeen: "2026-11-01",
      example: { es: sentence.es, en: sentence.en, date: "2026-11-01" },
    });
    expect(Object.keys(JSON.parse(backend.data.get(WORDS_KEY) ?? "{}"))).toEqual(["científico"]);
  });

  it("updates rather than duplicates and increments lookupCount", () => {
    const s = createStorage(fakeStorage());
    s.recordLookup(gloss, sentence, "2026-11-01");
    s.recordLookup(
      { surface: "científica", lemma: "científico", en: "scientific", pos: "adj" },
      { es: "Otra frase.", en: "Another." },
      "2026-11-03",
    );
    s.recordLookup({ ...gloss, surface: "científica" }, sentence, "2026-11-04");
    const words = s.getWords();
    expect(Object.keys(words)).toHaveLength(1);
    const rec = s.getWord("científico");
    expect(rec?.lookupCount).toBe(3);
    expect(rec?.forms).toEqual(["científicos", "científica"]);
    expect(rec?.en).toBe("scientist");
    expect(rec?.firstSeen).toBe("2026-11-01");
    expect(rec?.lastSeen).toBe("2026-11-04");
    expect(rec?.example?.es).toBe(sentence.es); // first example kept
  });

  it("updates en and pos from the most recent lookup", () => {
    const s = createStorage(fakeStorage());
    s.recordLookup(gloss, sentence, "2026-11-01");
    const rec = s.recordLookup({ surface: "científico", lemma: "científico", en: "scientific", pos: "adj" }, sentence, "2026-11-02");
    expect(rec.en).toBe("scientific");
    expect(rec.pos).toBe("adj");
  });

  it("saves automatically on lookup and keeps it across lookups", () => {
    const s = createStorage(fakeStorage());
    expect(s.recordLookup(gloss, sentence, "2026-11-01").saved).toBe(true);
    expect(s.recordLookup(gloss, sentence, "2026-11-02").saved).toBe(true);
    expect(s.getWord("científico")?.saved).toBe(true);
  });

  it("treats legacy saved=false records as saved", () => {
    const legacy = JSON.stringify({ científico: { lemma: "científico", forms: [], en: "x", lookupCount: 1, saved: false, firstSeen: "d", lastSeen: "d" } });
    const s = createStorage(fakeStorage({ [WORDS_KEY]: legacy }));
    expect(s.getWord("científico")?.saved).toBe(true);
    expect(s.recordLookup(gloss, sentence, "2026-11-02").saved).toBe(true);
  });

  it("removeWord deletes the record and a later lookup starts fresh", () => {
    const s = createStorage(fakeStorage());
    s.recordLookup(gloss, sentence, "2026-11-01");
    s.recordLookup(gloss, sentence, "2026-11-02");
    s.removeWord("científico");
    expect(s.getWord("científico")).toBeUndefined();
    s.removeWord("missing"); // no-op
    const rec = s.recordLookup(gloss, sentence, "2026-11-03");
    expect(rec).toMatchObject({ lookupCount: 1, saved: true, firstSeen: "2026-11-03" });
  });

  it("persists across instances sharing a backend", () => {
    const backend = fakeStorage();
    createStorage(backend).recordLookup(gloss, sentence, "2026-11-01");
    expect(createStorage(backend).getWord("científico")?.lookupCount).toBe(1);
  });

  it("treats corrupt JSON as empty and recovers on next write", () => {
    const backend = fakeStorage({ [WORDS_KEY]: "{not json", [SETTINGS_KEY]: "][" });
    const s = createStorage(backend);
    expect(s.getWords()).toEqual({});
    expect(s.getSettings()).toEqual({});
    s.recordLookup(gloss, sentence, "2026-11-01");
    expect(s.getWord("científico")?.lookupCount).toBe(1);
  });

  it("repairs malformed records and ignores junk entries", () => {
    const backend = fakeStorage({
      [WORDS_KEY]: JSON.stringify({ a: 5, b: { lemma: "b", lookupCount: "x", forms: [1, "f"] } }),
    });
    const s = createStorage(backend);
    expect(Object.keys(s.getWords())).toEqual(["b"]);
    expect(s.getWord("b")).toMatchObject({ lookupCount: 0, forms: ["f"], saved: true });
  });

  it("works in memory when storage throws", () => {
    const s = createStorage(throwing);
    expect(s.getWords()).toEqual({});
    s.recordLookup(gloss, sentence, "2026-11-01");
    s.recordLookup(gloss, sentence, "2026-11-02");
    expect(s.getWord("científico")).toMatchObject({ lookupCount: 2, saved: true });
    s.saveSettings({ ttsRate: 0.8 });
    expect(s.getSettings()).toEqual({ ttsRate: 0.8 });
  });

  it("works with no backend at all", () => {
    const s = createStorage(null);
    s.recordLookup(gloss, sentence, "2026-11-01");
    expect(s.getWord("científico")?.lookupCount).toBe(1);
  });

  it("does not throw when only writes fail (quota full)", () => {
    const backend = fakeStorage();
    const full: StorageLike = { ...backend, getItem: backend.getItem, setItem: throwing.setItem, removeItem: backend.removeItem };
    const s = createStorage(full);
    expect(() => s.recordLookup(gloss, sentence, "2026-11-01")).not.toThrow();
    expect(s.getWord("científico")?.lookupCount).toBe(1);
  });

  it("is safe against a __proto__ lemma", () => {
    const s = createStorage(fakeStorage());
    s.recordLookup({ surface: "x", lemma: "__proto__", en: "y" }, sentence, "2026-11-01");
    expect(s.getWord("__proto__")?.lookupCount).toBe(1);
  });

  it("round-trips settings", () => {
    const s = createStorage(fakeStorage());
    s.saveSettings({ theme: "dark", showEnglishByDefault: true });
    expect(s.getSettings()).toEqual({ theme: "dark", showEnglishByDefault: true });
  });
});
