import type { Digest, Sentence, Story } from "../../generator/src/schema";
import { matchGlosses } from "./glosses";
import { attachPlayback } from "./playback";
import { openWordPopover, closeWordPopover, type WordContext } from "./popover";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) if (v !== undefined) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

/** Lookup context for each glossed-word button, used when its popover opens. */
const wordContexts = new WeakMap<HTMLElement, WordContext>();

function renderSentence(sentence: Sentence, date: string): HTMLLIElement {
  const esP = el("p", { class: "es", lang: "es", tabindex: "0", "aria-expanded": "false" });
  for (const seg of matchGlosses(sentence.es, sentence.words)) {
    if (seg.gloss) {
      const btn = el(
        "button",
        {
          type: "button",
          class: "gloss",
          "data-lemma": seg.gloss.lemma,
          "aria-haspopup": "dialog",
        },
        [seg.text],
      );
      wordContexts.set(btn, {
        gloss: { surface: seg.text, lemma: seg.gloss.lemma, en: seg.gloss.en, pos: seg.gloss.pos },
        sentence: { es: sentence.es, en: sentence.en },
        date,
      });
      esP.append(btn);
    } else {
      esP.append(seg.text);
    }
  }
  const enP = el("p", { class: "en", lang: "en" }, [sentence.en]);
  return el("li", { class: "sentence", "data-open": "false" }, [esP, enP]);
}

function renderStory(story: Story, date: string): HTMLElement {
  const h2 = el("h2", { class: "headline" }, [el("span", { lang: "es" }, [story.headline.es])]);
  const sub = el("p", { class: "headline-en", lang: "en" }, [story.headline.en]);
  const link = el("a", { href: story.source.url, rel: "noopener noreferrer", target: "_blank" }, [story.source.name]);
  const source = el("p", { class: "source" }, ["Source: ", link]);
  const list = el("ol", { class: "sentences" }, story.sentences.map((s) => renderSentence(s, date)));
  return el("article", { class: "story", id: story.id, "aria-labelledby": `${story.id}-h` }, [
    Object.assign(h2, { id: `${story.id}-h` }),
    sub,
    list,
    source,
  ]);
}

/** Toggle the English line when tapping a sentence, but not when tapping a glossed word. */
function toggleSentence(li: HTMLElement): void {
  const open = li.dataset.open !== "true";
  li.dataset.open = String(open);
  li.querySelector(".es")?.setAttribute("aria-expanded", String(open));
}

export function renderDigest(digest: Digest, root: HTMLElement): void {
  const date = new Date(`${digest.date}T12:00:00`);
  const pretty = date.toLocaleDateString("es-MX", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const showAll = el("button", { type: "button", class: "toggle", "aria-pressed": "false" }, ["Show all English"]);
  showAll.addEventListener("click", () => {
    const on = showAll.getAttribute("aria-pressed") !== "true";
    showAll.setAttribute("aria-pressed", String(on));
    root.classList.toggle("show-all-en", on);
  });

  const header = el("header", { class: "digest-header" }, [
    el("h2", { class: "date" }, [el("time", { datetime: digest.date, lang: "es" }, [pretty])]),
    el("div", { class: "meta" }, [
      el("span", { class: "badge", title: "Level" }, [`Level ${digest.level}`]),
      el("span", { class: "variant" }, [digest.spanishVariant]),
      showAll,
    ]),
    el("p", { class: "hint" }, ["Tap a sentence for English. Dotted words have glosses."]),
  ]);
  // The date is the section heading for the page; avoid a competing h2 style clash.
  header.querySelector("h2")?.setAttribute("class", "date");

  const stories = digest.stories.map((s) => renderStory(s, digest.date));
  closeWordPopover(false);
  root.replaceChildren(header, ...stories);
  attachPlayback(digest, header, stories);

  root.onclick = (ev) => {
    const target = ev.target as HTMLElement;
    const word = target.closest<HTMLElement>(".gloss");
    if (word) {
      // Glossed words open the popover and never toggle the sentence's English.
      const ctx = wordContexts.get(word);
      if (ctx) openWordPopover(word, ctx);
      return;
    }
    const p = target.closest<HTMLElement>(".es");
    const li = p?.closest<HTMLElement>(".sentence");
    if (li) toggleSentence(li);
  };
  root.onkeydown = (ev) => {
    const target = ev.target as HTMLElement;
    if ((ev.key === "Enter" || ev.key === " ") && target.matches(".es")) {
      ev.preventDefault();
      const li = target.closest<HTMLElement>(".sentence");
      if (li) toggleSentence(li);
    }
  };
}
