import { DigestSchema, IndexSchema, type Digest } from "../../generator/src/schema";
import { renderDigest } from "./render";
import { closeWordPopover } from "./popover";
import { renderWords } from "./words";
import { stopPlayback } from "./playback";
import "./style.css";

type Route = "today" | "archive" | "words" | "settings";
const ROUTES: Route[] = ["today", "archive", "words", "settings"];

const base = import.meta.env.BASE_URL;

async function loadJson(path: string): Promise<unknown> {
  const res = await fetch(`${base}digests/${path}`);
  if (!res.ok) throw new Error(`Could not load ${path} (HTTP ${res.status})`);
  return res.json();
}

export async function loadLatestDigest(): Promise<Digest> {
  const index = IndexSchema.parse(await loadJson("index.json"));
  return DigestSchema.parse(await loadJson(`${index.latest}.json`));
}

function currentRoute(): Route {
  const name = location.hash.replace(/^#/, "") as Route;
  return ROUTES.includes(name) ? name : "today";
}

function message(main: HTMLElement, text: string, role: "status" | "alert" = "status"): void {
  const p = document.createElement("p");
  p.className = "message";
  p.setAttribute("role", role);
  p.textContent = text;
  main.replaceChildren(p);
}

async function showToday(main: HTMLElement): Promise<void> {
  message(main, "Loading…");
  try {
    renderDigest(await loadLatestDigest(), main);
  } catch (err) {
    message(main, `Could not load today's digest. ${err instanceof Error ? err.message : ""}`, "alert");
  }
}

async function render(): Promise<void> {
  const route = currentRoute();
  const main = document.getElementById("main");
  if (!main) return;
  stopPlayback(); // audio never outlives the view it was started from
  main.classList.remove("show-all-en");
  document.querySelectorAll<HTMLAnchorElement>("nav a").forEach((a) => {
    if (a.dataset.route === route) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  closeWordPopover(false);
  if (route === "today") await showToday(main);
  else if (route === "words") renderWords(main);
  else message(main, `The ${route} view is coming soon.`);
}

window.addEventListener("hashchange", () => void render());
void render();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${base}sw.js`).catch((err) => {
      console.warn("Service worker registration failed", err);
    });
  });
}
