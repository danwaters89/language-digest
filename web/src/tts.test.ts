import { describe, expect, it } from "vitest";
import {
  clampRate,
  createPlayer,
  pickVoice,
  type PlayerOptions,
  type SpeakRequest,
  type SynthLike,
  type TtsSentence,
  type VoiceLike,
} from "./tts";

const v = (voiceURI: string, lang: string, extra: Partial<VoiceLike> = {}): VoiceLike => ({
  voiceURI,
  lang,
  name: voiceURI,
  ...extra,
});

function fakeSynth(initial: VoiceLike[]) {
  let voices = initial;
  const listeners = new Set<() => void>();
  const events: string[] = [];
  const spoken: SpeakRequest[] = [];
  const synth: SynthLike = {
    getVoices: () => voices,
    speak(req) {
      events.push(`speak:${req.text}`);
      spoken.push(req);
    },
    cancel() {
      events.push("cancel");
    },
    subscribeVoices(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
  return {
    synth,
    spoken,
    events,
    listeners,
    last: () => spoken[spoken.length - 1] as SpeakRequest,
    setVoices(next: VoiceLike[]) {
      voices = next;
      listeners.forEach((cb) => cb());
    },
  };
}

const S: TtsSentence[] = [
  { id: "a:0", es: "Uno." },
  { id: "a:1", es: "Dos." },
  { id: "a:2", es: "Tres." },
];

function setup(extra: Partial<PlayerOptions> = {}, voices = [v("mx", "es-MX")]) {
  const f = fakeSynth(voices);
  const log: { sentence: (number | null)[]; state: string[]; ends: number; errors: string[] } = {
    sentence: [],
    state: [],
    ends: 0,
    errors: [],
  };
  const player = createPlayer({
    synth: f.synth,
    getVariant: () => "es-MX",
    onSentenceChange: (i) => void log.sentence.push(i),
    onStateChange: (s) => void log.state.push(s),
    onEnd: () => void log.ends++,
    onError: (e) => void log.errors.push(e),
    ...extra,
  });
  return { f, log, player };
}

describe("pickVoice", () => {
  it("prefers an exact variant match over other Spanish voices", () => {
    const voices = [v("es", "es-ES"), v("mx", "es-MX"), v("en", "en-US")];
    expect(pickVoice(voices, "es-MX")?.voiceURI).toBe("mx");
  });
  it("compares case-insensitively and treats _ like -", () => {
    expect(pickVoice([v("a", "es_mx")], "es-MX")?.voiceURI).toBe("a");
    expect(pickVoice([v("a", "ES-mx"), v("b", "es-ES")], "es_MX")?.voiceURI).toBe("a");
  });
  it("falls back to any es-* voice, including bare es", () => {
    expect(pickVoice([v("en", "en-US"), v("es", "es-ES")], "es-MX")?.voiceURI).toBe("es");
    expect(pickVoice([v("x", "es")], "es-MX")?.voiceURI).toBe("x");
  });
  it("prefers the default voice among equals", () => {
    const voices = [v("a", "es-MX"), v("b", "es-MX", { default: true })];
    expect(pickVoice(voices, "es-MX")?.voiceURI).toBe("b");
  });
  it("returns null when there is no Spanish voice", () => {
    expect(pickVoice([v("en", "en-US"), v("fr", "fr-FR")], "es-MX")).toBeNull();
    expect(pickVoice([], "es-MX")).toBeNull();
  });
  it("honours a voiceURI override, ignoring it if unknown", () => {
    const voices = [v("mx", "es-MX"), v("es", "es-ES")];
    expect(pickVoice(voices, "es-MX", "es")?.voiceURI).toBe("es");
    expect(pickVoice(voices, "es-MX", "gone")?.voiceURI).toBe("mx");
  });
});

describe("clampRate", () => {
  it("clamps to 0.6-1.2 and defaults to 1", () => {
    expect(clampRate(0.1)).toBe(0.6);
    expect(clampRate(5)).toBe(1.2);
    expect(clampRate(0.9)).toBe(0.9);
    expect(clampRate(undefined)).toBe(1);
    expect(clampRate(NaN)).toBe(1);
  });
});

describe("voice availability", () => {
  it("is unsupported without speechSynthesis and cannot start", () => {
    const player = createPlayer({ synth: null, getVariant: () => "es-MX" });
    expect(player.voiceStatus()).toBe("unsupported");
    expect(player.hasSpanishVoice()).toBe(false);
    expect(player.start("k", S)).toBe(false);
  });
  it("is unavailable when voices exist but none are Spanish", () => {
    const { player } = setup({}, [v("en", "en-US")]);
    expect(player.voiceStatus()).toBe("unavailable");
    expect(player.start("k", S)).toBe(false);
    expect(player.state()).toBe("idle");
  });
  it("waits for async voices, then becomes available", () => {
    let changes = 0;
    const { f, player } = setup({ onVoicesChange: () => void changes++, schedule: () => undefined }, []);
    expect(player.voiceStatus()).toBe("loading");
    f.setVoices([v("mx", "es_MX")]);
    expect(player.voiceStatus()).toBe("available");
    expect(changes).toBe(1);
  });
  it("gives up waiting after the timeout", () => {
    let fire: (() => void) | undefined;
    const { player } = setup({ schedule: (fn) => void (fire = fn) }, []);
    expect(player.voiceStatus()).toBe("loading");
    fire?.();
    expect(player.voiceStatus()).toBe("unavailable");
  });
  it("unsubscribes on dispose", () => {
    const { f, player } = setup();
    expect(f.listeners.size).toBe(1);
    player.dispose();
    expect(f.listeners.size).toBe(0);
  });
});

describe("playback", () => {
  it("speaks one sentence per utterance, cancelling first, with the chosen voice", () => {
    const { f, player } = setup();
    expect(player.start("k", S)).toBe(true);
    expect(f.events).toEqual(["cancel", "speak:Uno."]);
    expect(f.last().voice?.voiceURI).toBe("mx");
    expect(f.last().lang).toBe("es-MX");
    expect(player.state()).toBe("playing");
  });
  it("advances on end, reports indices, and finishes with onEnd", () => {
    const { f, log, player } = setup();
    player.start("k", S);
    f.last().onend();
    expect(player.index()).toBe(1);
    expect(f.last().text).toBe("Dos.");
    f.last().onend();
    expect(f.last().text).toBe("Tres.");
    f.last().onend();
    expect(log.ends).toBe(1);
    expect(player.state()).toBe("idle");
    expect(player.key()).toBeNull();
    expect(log.sentence).toEqual([0, 1, 2, null]);
    expect(log.state).toEqual(["playing", "idle"]);
  });
  it("starts at a given index (clamped)", () => {
    const { f, player } = setup();
    player.start("k", S, 2);
    expect(f.last().text).toBe("Tres.");
    player.start("k", S, 99);
    expect(player.index()).toBe(2);
  });
  it("applies the current rate (clamped) to each utterance", () => {
    let rate = 0.8;
    const { f, player } = setup({ getRate: () => rate });
    player.start("k", S);
    expect(f.last().rate).toBe(0.8);
    rate = 3;
    f.last().onend();
    expect(f.last().rate).toBe(1.2);
  });
  it("skips next/previous within bounds only", () => {
    const { f, player } = setup();
    player.start("k", S);
    expect(player.prev()).toBe(false);
    expect(player.next()).toBe(true);
    expect(f.last().text).toBe("Dos.");
    expect(player.next()).toBe(true);
    expect(player.next()).toBe(false);
    expect(player.index()).toBe(2);
    expect(player.prev()).toBe(true);
    expect(f.last().text).toBe("Dos.");
  });
  it("ignores skip when idle", () => {
    const { player } = setup();
    expect(player.next()).toBe(false);
    expect(player.prev()).toBe(false);
  });
  it("pause cancels and resume re-speaks the same sentence", () => {
    const { f, log, player } = setup();
    player.start("k", S);
    f.last().onend(); // now on index 1
    const before = f.spoken.length;
    player.pause();
    expect(player.state()).toBe("paused");
    expect(f.events[f.events.length - 1]).toBe("cancel");
    expect(f.spoken.length).toBe(before);
    player.resume();
    expect(player.state()).toBe("playing");
    expect(f.last().text).toBe("Dos.");
    expect(f.spoken.length).toBe(before + 1);
    expect(log.state).toEqual(["playing", "paused", "playing"]);
  });
  it("skipping while paused moves the index but stays silent", () => {
    const { f, player } = setup();
    player.start("k", S);
    player.pause();
    const n = f.spoken.length;
    expect(player.next()).toBe(true);
    expect(f.spoken.length).toBe(n);
    expect(player.state()).toBe("paused");
    player.resume();
    expect(f.last().text).toBe("Dos.");
  });
  it("stop clears everything without calling onEnd", () => {
    const { log, player } = setup();
    player.start("k", S);
    player.stop();
    expect(player.state()).toBe("idle");
    expect(player.length()).toBe(0);
    expect(log.ends).toBe(0);
  });
  it("starting a new queue replaces the old one", () => {
    const { f, player } = setup();
    player.start("a", S);
    player.start("b", [{ id: "b:0", es: "Otra." }]);
    expect(player.key()).toBe("b");
    expect(f.last().text).toBe("Otra.");
  });
});

describe("stale callbacks", () => {
  it("ignores onend from an utterance replaced by next()", () => {
    const { f, player } = setup();
    player.start("k", S);
    const old = f.last();
    player.next();
    old.onend(); // cancelled utterance finishing late
    expect(player.index()).toBe(1);
    expect(f.spoken.length).toBe(2);
  });
  it("ignores onend after pause", () => {
    const { f, player } = setup();
    player.start("k", S);
    const old = f.last();
    player.pause();
    old.onend();
    expect(player.index()).toBe(0);
    expect(f.spoken.length).toBe(1);
    expect(player.state()).toBe("paused");
  });
  it("ignores onend after stop and after a restart", () => {
    const { f, log, player } = setup();
    player.start("k", S);
    const first = f.last();
    player.stop();
    first.onend();
    expect(log.ends).toBe(0);
    expect(f.spoken.length).toBe(1);
    player.start("k", [{ id: "x", es: "Solo." }]);
    first.onend();
    expect(player.state()).toBe("playing");
    expect(log.ends).toBe(0);
  });
  it("ignores canceled/interrupted errors but stops on real errors", () => {
    const { f, log, player } = setup();
    player.start("k", S);
    f.last().onerror("interrupted");
    expect(player.state()).toBe("playing");
    f.last().onerror("synthesis-failed");
    expect(player.state()).toBe("idle");
    expect(log.errors).toEqual(["synthesis-failed"]);
  });
  it("ignores errors from stale utterances", () => {
    const { f, log, player } = setup();
    player.start("k", S);
    const old = f.last();
    player.next();
    old.onerror("synthesis-failed");
    expect(player.state()).toBe("playing");
    expect(log.errors).toEqual([]);
  });
});
