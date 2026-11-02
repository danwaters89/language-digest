# Spanish Daily News Reader: Design Brief

A brief for a coding agent (opencode) to build from. Build in the milestone order at the end and satisfy each milestone's acceptance criteria before moving on.

## 1. Goal

A personal Spanish-learning tool. Every morning it produces a digest of the day's news, written in simple Spanish at a configurable level, and publishes it as a static web page. The learner reads it, taps for English, taps words for glosses, saves words for review, and can listen via text to speech.

**Primary user:** a single learner (the author). No accounts, no multi-user concerns.

**Non-goals for v1:** user accounts, server-side sync, spaced repetition scheduling, native mobile apps, audio file generation.

## 2. Architecture

Two independent pieces connected by static JSON files.

1. **Generator** (Node + TypeScript CLI). Runs on a daily schedule. Fetches RSS, selects stories, calls an LLM, validates the output, writes `public/digests/YYYY-MM-DD.json` and updates `public/digests/index.json`.
2. **Front end** (static site, Vite + TypeScript). Loads `index.json` and the latest digest. No backend and no API keys in the browser. All learner state lives in `localStorage`.

Hosting: GitHub Pages (or any static host). Scheduling: a GitHub Actions cron workflow that runs the generator, commits the new JSON, and deploys.

### Suggested repo layout

```
/generator
  src/
    index.ts          # CLI entry
    feeds.ts          # RSS fetch + parse + dedupe
    select.ts         # story selection
    llm.ts            # provider-agnostic LLM client
    prompt.ts         # prompt construction
    schema.ts         # zod schemas shared with front end
    write.ts          # output + index update
  config.json
/web
  src/
    main.ts
    components/
    storage.ts        # localStorage wrapper
    tts.ts            # speechSynthesis wrapper
  public/
    digests/          # generated JSON lives here
    manifest.webmanifest
/.github/workflows/daily.yml
```

Share types between generator and web via a small shared package or by importing the zod schema file.

## 3. Configuration

`generator/config.json`:

```json
{
  "level": "A2",
  "timezone": "America/New_York",
  "maxStories": 6,
  "targetSentencesPerStory": 5,
  "feeds": [
    { "name": "BBC World", "url": "https://feeds.bbci.co.uk/news/world/rss.xml" },
    { "name": "NPR News", "url": "https://feeds.npr.org/1001/rss.xml" }
  ],
  "spanishVariant": "es-MX",
  "model": "<configurable>"
}
```

- `level` is a CEFR label (A1 to C1) and is injected into the prompt. Default A2; the user will adjust it.
- `timezone` determines what "today" means for the output filename.
- Secrets come from environment variables (`LLM_API_KEY`), never from the repo. The LLM client must be easy to swap between providers.

## 4. Generator behavior

1. **Fetch** all feeds in parallel with a timeout (10s) and one retry. A failed feed is logged and skipped; the run fails only if all feeds fail.
2. **Normalize** items to `{ title, summary, link, source, publishedAt }`. Drop items older than 36 hours.
3. **Dedupe** near-identical stories across feeds (normalized-title similarity is sufficient).
4. **Select** up to `maxStories`, preferring variety of source and topic. Simple round-robin across feeds is fine for v1.
5. **Generate** with one LLM call per run (or one per story if output size requires it). The model receives only titles, summaries, and links, and writes original summaries. Do not pass or reproduce full article text.
6. **Validate** the response against the zod schema. On failure, retry once with the validation errors appended to the prompt; if it fails again, exit non-zero without writing files.
7. **Write** `public/digests/YYYY-MM-DD.json` and update `index.json` (newest first). If a file for today exists, overwrite it.

## 5. Output data schema

```ts
type Digest = {
  date: string;              // YYYY-MM-DD
  level: string;             // e.g. "A2"
  spanishVariant: string;    // e.g. "es-MX"
  generatedAt: string;       // ISO timestamp
  stories: Story[];
};

type Story = {
  id: string;                // stable slug, e.g. "2026-11-03-1"
  headline: { es: string; en: string };
  source: { name: string; url: string };
  sentences: Sentence[];     // the body, in order
};

type Sentence = {
  es: string;
  en: string;
  words: Gloss[];            // only words above the learner's level
};

type Gloss = {
  surface: string;           // exactly as it appears in `es`
  lemma: string;             // dictionary form
  en: string;                // short contextual gloss
  pos?: string;              // optional part of speech
};
```

`index.json`:

```json
{ "latest": "2026-11-03", "dates": ["2026-11-03", "2026-11-02"] }
```

**Rule for the front end:** to make a word tappable, find each `Gloss.surface` inside `Sentence.es` (case-insensitive, whole-word match, first unmatched occurrence). Words with no gloss are rendered as plain text. The generator should validate that every `surface` actually occurs in its sentence and drop or repair any that do not.

## 6. LLM prompt specification

The system prompt should convey the following (refine wording as needed):

- You are writing a daily news digest for a Spanish learner at CEFR level {level}, using {spanishVariant} vocabulary and spelling.
- For each provided story, write an original summary of {targetSentencesPerStory} short sentences. Do not copy phrasing from the source text.
- Spanish must match level {level}: short sentences, common vocabulary, mostly present tense plus simple past at A2, avoid subjunctive below B1, avoid idioms unless glossed.
- For each sentence, provide a faithful English translation.
- For each sentence, list glosses only for words a {level} learner would probably not know. Include the lemma, and keep glosses short and specific to the sentence's meaning. Do not gloss articles, pronouns, or very common words.
- Keep tone neutral and factual. Do not add facts that are not in the provided material.
- Respond with JSON only, matching the provided schema. No markdown fences, no commentary.

Provide the JSON schema (or zod-derived JSON schema) in the prompt. If the provider supports structured output or tool-call JSON, use it.

## 7. Front end

### Views

- **Today (default).** The latest digest. Date header, level badge, and list of stories.
- **Archive.** List of past dates from `index.json`; selecting one loads that digest.
- **Saved words.** The learner's saved vocabulary, sortable by recent or by lookup count, with export.
- **Settings.** TTS voice and speed, text size, show/hide English by default, theme.

Simple hash routing is enough (`#today`, `#archive`, `#words`, `#settings`).

### Interactions

| Interaction | Behavior |
| --- | --- |
| Tap a sentence (not on a word) | Toggle the English line beneath it. |
| Tap a glossed word | Popover with lemma, gloss, and part of speech, plus a **Save** button (or a saved indicator). Increments the word's lookup count. |
| Play button on a story | Reads the story sentence by sentence, highlighting the current sentence. Play/pause and skip next/previous sentence. |
| Play all | Reads the whole digest in order. |
| Show-all-English toggle | Reveals English for every sentence at once. |

Glossed words should have a subtle visual cue (e.g. dotted underline) so the learner knows they are tappable.

### Text to speech

- Use the Web Speech API (`speechSynthesis`) with a voice matching `spanishVariant`, falling back to any `es-*` voice. If no Spanish voice exists, show a clear message instead of silently failing.
- Speed slider from 0.6x to 1.2x, persisted in settings.
- Speak one sentence per utterance so that highlighting and skipping are accurate. Handle known browser quirks (cancel before speaking, resume after pause on mobile Safari).

### Mobile first

The primary device is a phone. Tap targets at least 44px, readable base font size (18px or larger), single-column layout, no hover-dependent features. Support light and dark mode via `prefers-color-scheme`.

### PWA

Include a web manifest and a service worker that caches the app shell and the most recent digests so that today's digest is readable offline once loaded. Installable to the home screen.

### Accessibility

Semantic HTML, keyboard operable popovers (Escape to close), focus management, sufficient contrast, and `lang="es"` on Spanish text and `lang="en"` on English text so screen readers and TTS pick the right language.

## 8. Learner state and storage

All state is client-side in `localStorage`, accessed only through a `storage.ts` module that exposes a small API, so the backing store can later be swapped for IndexedDB or a server.

```ts
type WordRecord = {
  lemma: string;          // primary key
  forms: string[];        // surface forms seen
  en: string;             // most recent gloss
  pos?: string;
  lookupCount: number;
  saved: boolean;
  firstSeen: string;      // ISO date
  lastSeen: string;       // ISO date
  example?: { es: string; en: string; date: string };
};
```

- Storage keys are namespaced and versioned, e.g. `sdn:v1:words`, `sdn:v1:settings`.
- Words are stored as one object keyed by lemma. Looking up a word again updates `lookupCount` and `lastSeen` rather than creating a duplicate.
- Every read and write is wrapped in try/catch; the app must work when storage is unavailable or full.
- **Export:** buttons for JSON and CSV (lemma, gloss, example sentence, count, dates). The CSV should be importable into Anki as-is.
- **Import:** accept a previously exported JSON file and merge by lemma.
- Expected volume is a few hundred to a few thousand records, which is far below localStorage limits.

## 9. Scheduling and deployment

`.github/workflows/daily.yml`:

- Trigger: cron (once each morning, UTC time chosen so it lands before the learner's morning) plus `workflow_dispatch` for manual runs.
- Steps: checkout, install, run generator with `LLM_API_KEY` from repo secrets, commit any changed files under `web/public/digests/`, build the web app, deploy to GitHub Pages.
- If the generator exits non-zero, the workflow fails and no partial files are committed. Yesterday's digest remains available.
- Keep the digest history in the repo; files are small.

## 10. Quality and safety

- **Copyright:** the generator sends only titles, summaries, and links; the model writes original summaries; each story links to its source. Do not republish article text.
- **Faithfulness:** the prompt forbids adding facts. Keep the English translation visible alongside the Spanish so the learner can catch mistakes.
- **Tests:** unit tests for schema validation, the `surface`-in-sentence check, feed dedupe, and the storage module. A small fixture digest committed to the repo lets the front end be developed without calling the LLM.
- **Observability:** the generator logs feeds fetched, stories selected, token usage, and validation retries.

## 11. Milestones and acceptance criteria

1. **Generator MVP.** Running `npm run generate` writes a schema-valid digest file and updates `index.json`. Fails cleanly on invalid LLM output. Includes a `--dry-run` that uses a fixture instead of calling the LLM.
2. **Reader page.** The front end renders the latest digest from the fixture. Tap a sentence to toggle English; show-all toggle works; layout is good on a 390px-wide viewport.
3. **Word interactions.** Tapping a glossed word opens the popover; saving works; the Saved words view lists records and persists across reloads; lookup counts increment.
4. **Text to speech.** Per-story and play-all playback with sentence highlighting, speed control, and a clear message when no Spanish voice is available.
5. **Archive and settings.** Browse past digests; settings persist; light and dark modes.
6. **Export and import.** JSON and CSV export, JSON import with merge by lemma.
7. **PWA and scheduling.** Installable, offline reading of cached digests, and the GitHub Actions workflow publishes a new digest daily.

## 12. Later ideas (out of scope for v1)

- Spaced repetition review mode using saved words.
- Comprehension questions at the end of each story.
- Multiple difficulty versions of each digest.
- Cloud-synced learner state.
- Pre-generated audio instead of device TTS.
- Tap-to-translate for words that have no pre-computed gloss, via a small on-demand lookup.
