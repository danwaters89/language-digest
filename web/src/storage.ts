// Learner state (brief section 8). All persistence goes through this module so
// the backing store can later be swapped. Every read/write is guarded: if
// localStorage is unavailable, corrupt or full, we fall back to memory.

export type WordRecord = {
  lemma: string; // primary key
  forms: string[]; // surface forms seen
  en: string; // most recent gloss
  pos?: string;
  lookupCount: number;
  saved: boolean;
  firstSeen: string; // ISO date
  lastSeen: string; // ISO date
  example?: { es: string; en: string; date: string };
};

export type WordMap = Record<string, WordRecord>;

export type Settings = {
  showEnglishByDefault?: boolean;
  ttsRate?: number;
  /** voiceURI of a user-chosen speech voice; overrides automatic selection. */
  ttsVoice?: string;
  textSize?: number;
  theme?: "light" | "dark" | "system";
};

export type GlossInput = { surface: string; lemma: string; en: string; pos?: string };
export type SentenceInput = { es: string; en: string };

export const WORDS_KEY = "sdn:v1:words";
export const SETTINGS_KEY = "sdn:v1:settings";

/** The subset of the Storage interface we rely on (eases testing). */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function emptyWords(): WordMap {
  return Object.create(null) as WordMap;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Validate/repair one record from untrusted JSON. Returns undefined if unusable. */
function sanitizeRecord(key: string, raw: unknown): WordRecord | undefined {
  if (!isObject(raw)) return undefined;
  const lemma = str(raw.lemma) ?? key;
  if (!lemma) return undefined;
  const forms = Array.isArray(raw.forms) ? raw.forms.filter((f): f is string => typeof f === "string") : [];
  const lookupCount =
    typeof raw.lookupCount === "number" && Number.isFinite(raw.lookupCount) && raw.lookupCount >= 0
      ? Math.floor(raw.lookupCount)
      : 0;
  const firstSeen = str(raw.firstSeen) ?? str(raw.lastSeen) ?? "";
  const lastSeen = str(raw.lastSeen) ?? firstSeen;
  const rec: WordRecord = {
    lemma,
    forms,
    en: str(raw.en) ?? "",
    lookupCount,
    saved: true, // every stored word is saved; legacy saved=false records are treated as saved
    firstSeen,
    lastSeen,
  };
  const pos = str(raw.pos);
  if (pos) rec.pos = pos;
  const ex = raw.example;
  if (isObject(ex) && typeof ex.es === "string" && typeof ex.en === "string") {
    rec.example = { es: ex.es, en: ex.en, date: str(ex.date) ?? "" };
  }
  return rec;
}

export type LearnerStorage = {
  getWords(): WordMap;
  getWord(lemma: string): WordRecord | undefined;
  /** Create or update the record for gloss.lemma, count one lookup and mark it saved. */
  recordLookup(gloss: GlossInput, sentence: SentenceInput, date: string): WordRecord;
  /** Delete the record for lemma entirely. */
  removeWord(lemma: string): void;
  getSettings(): Settings;
  saveSettings(settings: Settings): void;
};

export function createStorage(backend?: StorageLike | null): LearnerStorage {
  // Values whose latest write failed (storage full/unavailable) live here.
  const memory = new Map<string, string>();

  function read(key: string): string | null {
    if (memory.has(key)) return memory.get(key) ?? null;
    try {
      return backend ? backend.getItem(key) : null;
    } catch {
      return null;
    }
  }

  function write(key: string, value: string): void {
    try {
      if (!backend) throw new Error("no storage");
      backend.setItem(key, value);
      memory.delete(key);
    } catch {
      memory.set(key, value);
    }
  }

  function readJson(key: string): unknown {
    const raw = read(key);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  function getWords(): WordMap {
    const parsed = readJson(WORDS_KEY);
    const out = emptyWords();
    if (!isObject(parsed)) return out;
    for (const [key, raw] of Object.entries(parsed)) {
      const rec = sanitizeRecord(key, raw);
      if (rec) out[rec.lemma] = rec;
    }
    return out;
  }

  function putWords(words: WordMap): void {
    write(WORDS_KEY, JSON.stringify(words));
  }

  function getWord(lemma: string): WordRecord | undefined {
    return getWords()[lemma];
  }

  function recordLookup(gloss: GlossInput, sentence: SentenceInput, date: string): WordRecord {
    const words = getWords();
    const form = gloss.surface.toLocaleLowerCase("es");
    const existing = words[gloss.lemma];
    const rec: WordRecord = existing ?? {
      lemma: gloss.lemma,
      forms: [],
      en: gloss.en,
      lookupCount: 0,
      saved: true,
      firstSeen: date,
      lastSeen: date,
    };
    if (form && !rec.forms.some((f) => f.toLocaleLowerCase("es") === form)) rec.forms.push(form);
    rec.en = gloss.en;
    if (gloss.pos) rec.pos = gloss.pos;
    rec.saved = true;
    rec.lookupCount += 1;
    rec.lastSeen = date;
    if (!rec.example) rec.example = { es: sentence.es, en: sentence.en, date };
    words[gloss.lemma] = rec;
    putWords(words);
    return rec;
  }

  function removeWord(lemma: string): void {
    const words = getWords();
    if (!(lemma in words)) return;
    delete words[lemma];
    putWords(words);
  }

  function getSettings(): Settings {
    const parsed = readJson(SETTINGS_KEY);
    return isObject(parsed) ? (parsed as Settings) : {};
  }

  function saveSettings(settings: Settings): void {
    write(SETTINGS_KEY, JSON.stringify(settings));
  }

  return { getWords, getWord, recordLookup, removeWord, getSettings, saveSettings };
}

function defaultBackend(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // accessing localStorage can itself throw (privacy modes)
  }
}

/** App-wide instance backed by localStorage (or memory if unavailable). */
export const storage: LearnerStorage = createStorage(defaultBackend());
