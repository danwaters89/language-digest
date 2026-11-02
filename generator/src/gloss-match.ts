/**
 * Pure gloss-matching logic, shared by the generator (validation) and the web
 * app (rendering). Rule: find each `Gloss.surface` inside the sentence
 * (case-insensitive, whole-word, first occurrence not already claimed).
 */

export type GlossLike = { surface: string };

export type Segment<G extends GlossLike = GlossLike> = { text: string; gloss?: G };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function wholeWordRegex(surface: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(surface)}(?![\\p{L}\\p{N}_])`, "giu");
}

type Range = { start: number; end: number };

/** Locate the first whole-word, case-insensitive occurrence not overlapping `used`. */
export function findSurface(es: string, surface: string, used: Range[] = []): Range | null {
  if (!surface) return null;
  const re = wholeWordRegex(surface);
  for (const m of es.matchAll(re)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!used.some((u) => start < u.end && end > u.start)) return { start, end };
  }
  return null;
}

/** Split a sentence into plain and glossed segments. Unmatched glosses are ignored. */
export function matchGlosses<G extends GlossLike>(es: string, glosses: readonly G[]): Segment<G>[] {
  const claimed: (Range & { gloss: G })[] = [];
  for (const gloss of glosses) {
    const r = findSurface(es, gloss.surface, claimed);
    if (r) claimed.push({ ...r, gloss });
  }
  claimed.sort((a, b) => a.start - b.start);

  const segments: Segment<G>[] = [];
  let cursor = 0;
  for (const c of claimed) {
    if (c.start > cursor) segments.push({ text: es.slice(cursor, c.start) });
    segments.push({ text: es.slice(c.start, c.end), gloss: c.gloss });
    cursor = c.end;
  }
  if (cursor < es.length) segments.push({ text: es.slice(cursor) });
  return segments;
}

/** True when every gloss surface can be located in the sentence. */
export function allSurfacesPresent(es: string, glosses: readonly GlossLike[]): boolean {
  const used: Range[] = [];
  for (const g of glosses) {
    const r = findSurface(es, g.surface, used);
    if (!r) return false;
    used.push(r);
  }
  return true;
}

export type RepairResult<G extends GlossLike> = { words: G[]; dropped: G[]; repaired: G[] };

/**
 * Drop or repair glosses whose surface does not occur in the sentence.
 * Repair: trim whitespace, or fall back to the lemma if that occurs as a whole word.
 */
export function repairGlosses<G extends GlossLike & { lemma?: string }>(
  es: string,
  glosses: readonly G[],
): RepairResult<G> {
  const used: Range[] = [];
  const words: G[] = [];
  const dropped: G[] = [];
  const repaired: G[] = [];
  for (const g of glosses) {
    const candidates = [g.surface, g.surface.trim(), g.lemma ?? ""];
    let done = false;
    for (let i = 0; i < candidates.length && !done; i++) {
      const cand = candidates[i];
      if (!cand) continue;
      const r = findSurface(es, cand, used);
      if (!r) continue;
      used.push(r);
      const actual = es.slice(r.start, r.end);
      if (cand === g.surface) {
        words.push(g);
      } else {
        const fixed = { ...g, surface: actual };
        words.push(fixed);
        repaired.push(fixed);
      }
      done = true;
    }
    if (!done) dropped.push(g);
  }
  return { words, dropped, repaired };
}
