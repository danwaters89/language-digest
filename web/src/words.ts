import { storage, type WordRecord } from "./storage";

type SortKey = "recent" | "count";

let sortKey: SortKey = "recent";

function mk<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function sortWords(words: WordRecord[], key: SortKey): WordRecord[] {
  const copy = [...words];
  if (key === "count") {
    copy.sort((a, b) => b.lookupCount - a.lookupCount || b.lastSeen.localeCompare(a.lastSeen) || a.lemma.localeCompare(b.lemma, "es"));
  } else {
    copy.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || b.lookupCount - a.lookupCount || a.lemma.localeCompare(b.lemma, "es"));
  }
  return copy;
}

function renderItem(rec: WordRecord, onRemove: () => void): HTMLLIElement {
  const li = mk("li", "word-item");
  const head = mk("div", "word-head");
  const lemma = mk("h3", "word-lemma", rec.lemma);
  lemma.lang = "es";
  head.append(lemma);
  if (rec.pos) head.append(mk("span", "word-pos", rec.pos));
  const gloss = mk("p", "word-gloss", rec.en);
  gloss.lang = "en";
  li.append(head, gloss);

  const meta = mk("p", "word-meta");
  const parts: string[] = [];
  if (rec.forms.length) parts.push(`Forms: ${rec.forms.join(", ")}`);
  parts.push(`Looked up ${rec.lookupCount} ${rec.lookupCount === 1 ? "time" : "times"}`);
  if (rec.lastSeen) parts.push(`Last seen ${rec.lastSeen}`);
  meta.textContent = parts.join(" · ");
  li.append(meta);

  if (rec.example) {
    const ex = mk("blockquote", "word-example");
    const es = mk("p", "word-example-es", rec.example.es);
    es.lang = "es";
    const en = mk("p", "word-example-en", rec.example.en);
    en.lang = "en";
    ex.append(es, en);
    li.append(ex);
  }

  const remove = mk("button", "word-remove", "Remove");
  remove.type = "button";
  remove.setAttribute("aria-label", `Remove ${rec.lemma} from saved words`);
  remove.addEventListener("click", onRemove);
  li.append(remove);
  return li;
}

export function renderWords(root: HTMLElement): void {
  root.replaceChildren();
  const saved = Object.values(storage.getWords()); // every stored word is saved

  const heading = mk("h2", "words-heading", "Saved words");
  heading.tabIndex = -1;
  root.append(heading);

  if (saved.length === 0) {
    const p = mk("p", "message", "No saved words yet. Tap a dotted word while reading to collect it here.");
    p.setAttribute("role", "status");
    root.append(p);
    return;
  }

  const sortBar = mk("div", "words-sort");
  sortBar.setAttribute("role", "group");
  sortBar.setAttribute("aria-label", "Sort saved words");
  const options: [SortKey, string][] = [
    ["recent", "Recent"],
    ["count", "Most looked up"],
  ];
  const list = mk("ul", "words-list");
  const buttons: HTMLButtonElement[] = [];

  const fill = (): void => {
    list.replaceChildren(
      ...sortWords(saved, sortKey).map((rec) =>
        renderItem(rec, () => {
          storage.removeWord(rec.lemma);
          renderWords(root);
          root.querySelector<HTMLElement>(".words-heading")?.focus();
        }),
      ),
    );
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(options[i][0] === sortKey)));
  };

  for (const [key, label] of options) {
    const b = mk("button", "toggle", label);
    b.type = "button";
    b.addEventListener("click", () => {
      sortKey = key;
      fill();
    });
    buttons.push(b);
    sortBar.append(b);
  }

  const count = mk("p", "hint", `${saved.length} saved ${saved.length === 1 ? "word" : "words"}`);
  root.append(count, sortBar, list);
  fill();
}
