import { storage, type GlossInput, type SentenceInput, type WordRecord } from "./storage";

export type WordContext = { gloss: GlossInput; sentence: SentenceInput; date: string };

type Open = { popover: HTMLElement; anchor: HTMLElement; cleanup: () => void };
let current: Open | null = null;
let counter = 0;

const MARGIN = 8;
const GAP = 6;

function mk<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function closeWordPopover(restoreFocus = true): void {
  if (!current) return;
  const { popover, anchor, cleanup } = current;
  current = null;
  cleanup();
  const hadFocus = popover.contains(document.activeElement) || document.activeElement === document.body;
  popover.remove();
  anchor.removeAttribute("aria-expanded");
  if (restoreFocus && hadFocus && anchor.isConnected) anchor.focus();
}

function position(popover: HTMLElement, anchor: HTMLElement): void {
  const doc = document.documentElement;
  const viewW = doc.clientWidth;
  const rect = anchor.getBoundingClientRect();
  const w = popover.offsetWidth;
  const h = popover.offsetHeight;
  const minLeft = MARGIN;
  const maxLeft = Math.max(minLeft, viewW - w - MARGIN);
  const left = Math.min(Math.max(rect.left + rect.width / 2 - w / 2, minLeft), maxLeft);
  const below = rect.bottom + GAP;
  const fitsBelow = below + h <= window.innerHeight;
  const above = rect.top - GAP - h;
  const top = fitsBelow || above < 0 ? below : above;
  popover.style.left = `${left + window.scrollX}px`;
  popover.style.top = `${top + window.scrollY}px`;
}

export function openWordPopover(anchor: HTMLElement, ctx: WordContext): void {
  closeWordPopover(false);
  const rec: WordRecord = storage.recordLookup(ctx.gloss, ctx.sentence, ctx.date);

  const id = `word-popover-${++counter}`;
  const popover = mk("div", "word-popover");
  popover.id = id;
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-labelledby", `${id}-lemma`);
  popover.setAttribute("aria-describedby", `${id}-gloss`);
  popover.tabIndex = -1;

  const lemma = mk("p", "wp-lemma", ctx.gloss.lemma);
  lemma.id = `${id}-lemma`;
  lemma.lang = "es";
  const gloss = mk("p", "wp-gloss", ctx.gloss.en);
  gloss.id = `${id}-gloss`;
  gloss.lang = "en";
  const pos = ctx.gloss.pos ? mk("p", "wp-pos", ctx.gloss.pos) : null;
  const count = mk("p", "wp-count");
  const status = mk("p", "sr-only", `${rec.lemma} saved to your words`);
  status.setAttribute("role", "status");

  const close = mk("button", "wp-close", "Close");
  close.type = "button";

  count.textContent = `Looked up ${rec.lookupCount} ${rec.lookupCount === 1 ? "time" : "times"}`;
  close.addEventListener("click", () => closeWordPopover());

  const actions = mk("div", "wp-actions");
  actions.append(close);
  popover.append(lemma, gloss, ...(pos ? [pos] : []), count, actions, status);
  document.body.append(popover);
  anchor.setAttribute("aria-expanded", "true");

  const onKeydown = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      closeWordPopover();
    } else if (ev.key === "Tab") {
      // Keep keyboard focus within the popover while it is open.
      // The Close button is the only focusable element, so Tab stays on it.
      ev.preventDefault();
      close.focus();
    }
  };
  const onPointerDown = (ev: Event): void => {
    const t = ev.target as Node;
    if (popover.contains(t)) return;
    closeWordPopover(true);
  };
  const onResize = (): void => position(popover, anchor);

  document.addEventListener("keydown", onKeydown);
  document.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("resize", onResize);
  const cleanup = (): void => {
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("resize", onResize);
  };
  current = { popover, anchor, cleanup };

  position(popover, anchor);
  close.focus();
}
