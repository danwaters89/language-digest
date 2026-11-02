// Text to speech (brief section 7). The player is written against a tiny
// `SynthLike` interface so it can be unit-tested with a fake; `browserSynth()`
// adapts the real window.speechSynthesis.
//
// Design notes (browser quirks):
// - One sentence per utterance, so highlighting and skipping are exact.
// - speechSynthesis.cancel() is called before every speak().
// - pause() is implemented as cancel + remember index; resume() re-speaks the
//   current sentence. Native pause()/resume() is unreliable on mobile Safari.
// - Cancelled utterances still fire onend/onerror (asynchronously). Every
//   utterance carries a token and callbacks from stale tokens are ignored.

export type VoiceLike = { voiceURI: string; lang: string; name: string; default?: boolean };

export type SpeakRequest = {
  text: string;
  lang: string;
  rate: number;
  voice: VoiceLike | null;
  onend: () => void;
  onerror: (error?: string) => void;
};

export type SynthLike = {
  getVoices(): VoiceLike[];
  speak(req: SpeakRequest): void;
  cancel(): void;
  /** Subscribe to the async "voices loaded" event; returns an unsubscribe fn. */
  subscribeVoices?(cb: () => void): () => void;
};

export type TtsSentence = { id: string; es: string };
export type PlayerState = "idle" | "playing" | "paused";
export type VoiceStatus = "unsupported" | "loading" | "available" | "unavailable";

export const MIN_RATE = 0.6;
export const MAX_RATE = 1.2;
export const DEFAULT_RATE = 1;

export function clampRate(rate: unknown): number {
  if (typeof rate !== "number" || !Number.isFinite(rate)) return DEFAULT_RATE;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
}

function normLang(lang: string): string {
  return lang.trim().toLowerCase().replace(/_/g, "-");
}

export function isSpanishVoice(v: VoiceLike): boolean {
  const l = normLang(v.lang);
  return l === "es" || l.startsWith("es-");
}

/**
 * Pick a voice: explicit override (voiceURI) first, then an exact match for the
 * digest's variant (e.g. es-MX), then any Spanish voice. Null if none.
 */
export function pickVoice<V extends VoiceLike>(voices: V[], variant: string, overrideURI?: string): V | null {
  if (overrideURI) {
    const chosen = voices.find((v) => v.voiceURI === overrideURI);
    if (chosen) return chosen;
  }
  const spanish = voices.filter(isSpanishVoice);
  const prefer = (list: V[]): V | null => list.find((v) => v.default) ?? list[0] ?? null;
  const want = normLang(variant);
  const exact = spanish.filter((v) => normLang(v.lang) === want);
  return exact.length > 0 ? prefer(exact) : prefer(spanish);
}

export type PlayerOptions = {
  synth: SynthLike | null;
  getVariant: () => string;
  getRate?: () => number;
  getVoiceURI?: () => string | undefined;
  /** Injectable timer, used to stop waiting for async voices. */
  schedule?: (fn: () => void, ms: number) => void;
  voiceLoadTimeoutMs?: number;
  onSentenceChange?: (index: number | null, sentence: TtsSentence | null) => void;
  onStateChange?: (state: PlayerState) => void;
  /** Called when the queue is read through to the end (not on stop()). */
  onEnd?: () => void;
  onError?: (error: string) => void;
  onVoicesChange?: () => void;
};

export type Player = {
  voiceStatus(): VoiceStatus;
  hasSpanishVoice(): boolean;
  voice(): VoiceLike | null;
  state(): PlayerState;
  key(): string | null;
  index(): number;
  length(): number;
  /** Replace the queue and start speaking at `index`. False if it can't play. */
  start(key: string, sentences: TtsSentence[], index?: number): boolean;
  pause(): void;
  resume(): void;
  next(): boolean;
  prev(): boolean;
  stop(): void;
  dispose(): void;
};

export function createPlayer(opts: PlayerOptions): Player {
  const synth = opts.synth;
  let queue: TtsSentence[] = [];
  let key: string | null = null;
  let idx = 0;
  let state: PlayerState = "idle";
  let token = 0;
  let voices: VoiceLike[] = [];
  let waitedForVoices = false;

  function refreshVoices(): void {
    try {
      voices = synth ? synth.getVoices() : [];
    } catch {
      voices = [];
    }
  }

  function currentVoice(): VoiceLike | null {
    return pickVoice(voices, opts.getVariant(), opts.getVoiceURI?.());
  }

  function voiceStatus(): VoiceStatus {
    if (!synth) return "unsupported";
    if (currentVoice()) return "available";
    if (voices.length === 0 && !waitedForVoices) return "loading";
    return "unavailable";
  }

  refreshVoices();
  const unsubscribe = synth?.subscribeVoices?.(() => {
    refreshVoices();
    opts.onVoicesChange?.();
  });
  if (synth && voices.length === 0) {
    const schedule = opts.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
    schedule(() => {
      waitedForVoices = true;
      refreshVoices();
      opts.onVoicesChange?.();
    }, opts.voiceLoadTimeoutMs ?? 1500);
  }

  function setState(next: PlayerState): void {
    if (state === next) return;
    state = next;
    opts.onStateChange?.(state);
  }

  function reset(): void {
    token++; // invalidate any in-flight utterance callbacks
    queue = [];
    key = null;
    idx = 0;
    opts.onSentenceChange?.(null, null);
    setState("idle");
  }

  function speakCurrent(): void {
    if (!synth) return;
    const mine = ++token;
    const sentence = queue[idx];
    if (!sentence) return;
    synth.cancel();
    const voice = currentVoice();
    synth.speak({
      text: sentence.es,
      lang: voice?.lang ?? opts.getVariant(),
      rate: clampRate(opts.getRate?.()),
      voice,
      onend: () => {
        if (mine !== token) return; // stale: cancelled, skipped or paused
        if (idx + 1 < queue.length) {
          idx++;
          opts.onSentenceChange?.(idx, queue[idx] ?? null);
          speakCurrent();
        } else {
          reset();
          opts.onEnd?.();
        }
      },
      onerror: (error) => {
        if (mine !== token) return;
        if (error === "canceled" || error === "interrupted") return;
        synth.cancel();
        reset();
        opts.onError?.(error ?? "unknown");
      },
    });
  }

  function start(newKey: string, sentences: TtsSentence[], index = 0): boolean {
    if (!synth || sentences.length === 0 || voiceStatus() !== "available") return false;
    queue = sentences.slice();
    key = newKey;
    idx = Math.min(Math.max(0, Math.floor(index)), queue.length - 1);
    setState("playing");
    opts.onSentenceChange?.(idx, queue[idx] ?? null);
    speakCurrent();
    return true;
  }

  function pause(): void {
    if (state !== "playing" || !synth) return;
    token++;
    synth.cancel();
    setState("paused");
  }

  function resume(): void {
    if (state !== "paused") return;
    setState("playing");
    speakCurrent();
  }

  function move(delta: number): boolean {
    if (state === "idle") return false;
    const target = idx + delta;
    if (target < 0 || target >= queue.length) return false;
    idx = target;
    opts.onSentenceChange?.(idx, queue[idx] ?? null);
    if (state === "playing") speakCurrent();
    else token++; // paused: stay paused on the new sentence
    return true;
  }

  function stop(): void {
    if (state === "idle") return;
    token++;
    synth?.cancel();
    reset();
  }

  return {
    voiceStatus,
    hasSpanishVoice: () => voiceStatus() === "available",
    voice: currentVoice,
    state: () => state,
    key: () => key,
    index: () => idx,
    length: () => queue.length,
    start,
    pause,
    resume,
    next: () => move(1),
    prev: () => move(-1),
    stop,
    dispose() {
      stop();
      unsubscribe?.();
    },
  };
}

// Chrome can garbage-collect an utterance before it ends and never fire onend,
// so keep a reference to the one being spoken.
let spoken: SpeechSynthesisUtterance | null = null;

/** Adapter over the real speechSynthesis, or null if unsupported. */
export function browserSynth(): SynthLike | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    return null;
  }
  const s = window.speechSynthesis;
  return {
    getVoices: () => s.getVoices(),
    cancel: () => s.cancel(),
    speak(req) {
      const u = new SpeechSynthesisUtterance(req.text);
      u.lang = req.lang;
      u.rate = req.rate;
      if (req.voice) {
        const real = s.getVoices().find((v) => v.voiceURI === req.voice?.voiceURI);
        if (real) u.voice = real;
      }
      u.onend = () => req.onend();
      u.onerror = (e) => req.onerror(e.error);
      spoken = u;
      s.speak(u);
    },
    subscribeVoices(cb) {
      s.addEventListener("voiceschanged", cb);
      return () => s.removeEventListener("voiceschanged", cb);
    },
  };
}
