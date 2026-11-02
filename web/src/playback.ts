// Player UI for the Today view: per-story controls, "Play all", speed slider,
// sentence highlighting and the "no Spanish voice" message. The audio logic
// lives in tts.ts; this module only wires it to the DOM.
import type { Digest } from "../../generator/src/schema";
import { storage } from "./storage";
import {
  MAX_RATE,
  MIN_RATE,
  browserSynth,
  clampRate,
  createPlayer,
  type Player,
  type TtsSentence,
} from "./tts";

type Controls = { el: HTMLElement; update(): void };

const ALL_KEY = "all";
let active: Player | null = null;

/** Stop any playback and release the speech listeners (call when leaving Today). */
export function stopPlayback(): void {
  active?.dispose();
  active = null;
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(cls: string, label: string, text: string): HTMLButtonElement {
  return h("button", { type: "button", class: `player-btn ${cls}`, "aria-label": label }, text);
}

const NO_VOICE =
  "No Spanish voice was found on this device, so audio can't play. Install a Spanish voice in your device's text-to-speech or language settings.";
const UNSUPPORTED = "This browser doesn't support text to speech, so audio can't play.";
const LOADING = "Checking for Spanish voices…";

export function attachPlayback(digest: Digest, header: HTMLElement, storyEls: HTMLElement[]): void {
  stopPlayback();

  const liById = new Map<string, HTMLElement>();
  const storyQueues: { key: string; label: string; queue: TtsSentence[]; el: HTMLElement }[] = [];
  const allQueue: TtsSentence[] = [];
  digest.stories.forEach((story, si) => {
    const el = storyEls[si];
    if (!el) return;
    const items = el.querySelectorAll<HTMLElement>(".sentence");
    const queue: TtsSentence[] = [];
    story.sentences.forEach((s, i) => {
      const id = `${story.id}:${i}`;
      const li = items[i];
      if (li) liById.set(id, li);
      queue.push({ id, es: s.es });
    });
    allQueue.push(...queue);
    storyQueues.push({ key: story.id, label: story.headline.en || story.headline.es, queue, el });
  });

  const controls: Controls[] = [];
  const statusEl = h("p", { class: "player-status", role: "status", "aria-live": "polite" });
  let finished = false;
  let currentLi: HTMLElement | null = null;

  function voiceMessage(): string | null {
    switch (player.voiceStatus()) {
      case "unsupported":
        return UNSUPPORTED;
      case "unavailable":
        return NO_VOICE;
      case "loading":
        return LOADING;
      default:
        return null;
    }
  }

  function updateAll(): void {
    const problem = voiceMessage();
    statusEl.textContent =
      problem ?? (player.state() === "playing" ? "Playing…" : player.state() === "paused" ? "Paused." : finished ? "Finished." : "");
    statusEl.classList.toggle("problem", problem !== null && player.voiceStatus() !== "loading");
    for (const c of controls) c.update();
  }

  function highlight(sentence: TtsSentence | null): void {
    currentLi?.classList.remove("speaking");
    currentLi?.removeAttribute("aria-current");
    currentLi = sentence ? (liById.get(sentence.id) ?? null) : null;
    if (!currentLi) return;
    currentLi.classList.add("speaking");
    currentLi.setAttribute("aria-current", "true");
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    currentLi.scrollIntoView?.({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }

  const player: Player = createPlayer({
    synth: browserSynth(),
    getVariant: () => digest.spanishVariant,
    getRate: () => clampRate(storage.getSettings().ttsRate),
    getVoiceURI: () => storage.getSettings().ttsVoice,
    onSentenceChange: (_i, sentence) => {
      highlight(sentence);
      updateAll();
    },
    onStateChange: () => updateAll(),
    onEnd: () => {
      finished = true;
      updateAll();
    },
    onError: () => {
      statusEl.textContent = "Audio stopped because the speech engine reported an error.";
      statusEl.classList.add("problem");
    },
    onVoicesChange: () => updateAll(),
  });
  active = player;

  function makeControls(key: string, groupLabel: string, playLabel: string, queue: TtsSentence[], cls: string): Controls {
    const prev = button("prev", "Previous sentence", "⏮");
    const play = button("play", playLabel, "▶ Play");
    const next = button("next", "Next sentence", "⏭");
    const note = h("p", { class: "player-note" });
    const el = h("div", { class: `player-controls ${cls}`, role: "group", "aria-label": groupLabel }, undefined);
    el.append(prev, play, next);

    play.addEventListener("click", () => {
      const mine = player.key() === key;
      if (mine && player.state() === "playing") player.pause();
      else if (mine && player.state() === "paused") player.resume();
      else {
        finished = false;
        player.start(key, queue, 0);
      }
    });
    prev.addEventListener("click", () => void player.prev());
    next.addEventListener("click", () => void player.next());

    const wrap = h("div", { class: "player-wrap" });
    wrap.append(el, note);
    return {
      el: wrap,
      update() {
        const usable = player.hasSpanishVoice();
        const mine = player.key() === key && player.state() !== "idle";
        const playing = mine && player.state() === "playing";
        const paused = mine && player.state() === "paused";
        const verb = playing ? "Pause" : paused ? "Resume" : "Play";
        play.textContent = `${playing ? "⏸" : "▶"} ${verb}`;
        play.setAttribute("aria-label", `${verb} ${playLabel.replace(/^(Play|Pause|Resume) /, "")}`);
        play.disabled = !usable;
        prev.disabled = !usable || !mine || player.index() <= 0;
        next.disabled = !usable || !mine || player.index() >= player.length() - 1;
        note.textContent = usable ? "" : "Audio unavailable.";
      },
    };
  }

  // Digest-level controls: Play all + speed slider + status message.
  const allControls = makeControls(ALL_KEY, "Play all stories", "Play all stories", allQueue, "all-controls");
  controls.push(allControls);

  const rate = clampRate(storage.getSettings().ttsRate);
  const slider = h("input", {
    type: "range",
    id: "tts-rate",
    min: String(MIN_RATE),
    max: String(MAX_RATE),
    step: "0.05",
    value: String(rate),
  });
  const rateOut = h("output", { for: "tts-rate" }, `${rate.toFixed(2)}×`);
  const showRate = (r: number): void => {
    rateOut.textContent = `${r.toFixed(2)}×`;
    slider.setAttribute("aria-valuetext", `${r.toFixed(2)} times speed`);
  };
  showRate(rate);
  slider.addEventListener("input", () => {
    const r = clampRate(Number(slider.value));
    showRate(r);
    storage.saveSettings({ ...storage.getSettings(), ttsRate: r }); // applies from the next sentence
  });
  const speed = h("div", { class: "speed" });
  speed.append(h("label", { for: "tts-rate" }, "Speed"), slider, rateOut);

  const panel = h("section", { class: "player", "aria-label": "Audio player" });
  panel.append(allControls.el, speed, statusEl);
  header.append(panel);

  // Per-story controls, placed under the English headline.
  for (const s of storyQueues) {
    const c = makeControls(s.key, "Story audio", `story: ${s.label}`, s.queue, "story-player");
    controls.push(c);
    const anchor = s.el.querySelector(".headline-en");
    if (anchor) anchor.after(c.el);
    else s.el.prepend(c.el);
  }

  updateAll();
}
