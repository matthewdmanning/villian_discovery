/**
 * How a review reached Fable: typed into the page's review box, only copied for the user to paste,
 * or neither, so the user copies it by hand.
 */
export type ReviewDelivery = "pasted" | "copied" | "manual";

const LOAD_MS = 20_000;

/** The handoff in progress. Handoffs share the Fable tab, so each waits for the one before it. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Open `pageUrl` in the Fable tab (or a new one) and paste `text` into the book's review box.
 * The text is copied first, so the user can paste it when Fable's page has no box this finds.
 * Handoffs run one at a time, and the text goes in only once the tab shows `pageUrl`.
 * Nothing is submitted: the user reviews and posts on Fable.
 */
export function postToFable(pageUrl: string, text: string): Promise<ReviewDelivery> {
  const url = new URL(pageUrl);
  if (url.protocol !== "https:" || url.hostname !== "fable.co")
    return Promise.reject(new Error("Not a Fable book page"));
  const run = queue.then(() => handOff(url, text));
  queue = run.catch(() => undefined);
  return run;
}

async function handOff(url: URL, text: string): Promise<ReviewDelivery> {
  const copied = await navigator.clipboard.writeText(text).then(
    () => true,
    () => false,
  );
  const fallback = copied ? "copied" : "manual";
  const [existing] = await chrome.tabs.query({ url: "https://fable.co/*" });
  const tab = existing?.id
    ? await chrome.tabs.update(existing.id, { url: url.href, active: true })
    : await chrome.tabs.create({ url: url.href });
  if (tab?.id === undefined) return fallback;
  if (existing) await chrome.windows.update(existing.windowId, { focused: true });
  if (!(await loaded(tab.id, url))) return fallback;
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: fillReview,
    args: [text, url.pathname],
  });
  return result?.result === true ? "pasted" : fallback;
}

/** Same book page: Fable may add a query or a trailing slash. */
function samePage(href: string | undefined, url: URL): boolean {
  if (!href) return false;
  const page = new URL(href);
  return page.origin === url.origin && page.pathname.replace(/\/$/, "") === url.pathname.replace(/\/$/, "");
}

/** Resolve whether the tab finished loading `url`, waiting at most `LOAD_MS`. */
function loaded(tabId: number, url: URL): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(ok);
    };
    const listener = (id: number, change: { status?: string }, tab?: { url?: string | undefined }) => {
      if (id === tabId && change.status === "complete" && samePage(tab?.url, url)) done(true);
    };
    const timer = setTimeout(() => done(false), LOAD_MS);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Runs in the Fable page. Find the book's review box, opening it with the page's review button when needed,
 * and type `text` into it the way a paste would. Returns whether the box now holds the text.
 * Does nothing unless the page is `pathname`, so a tab that moved on keeps its fields.
 * Self-contained: `chrome.scripting` serializes this function, so it may use nothing from this module.
 */
export async function fillReview(text: string, pathname?: string, timeoutMs = 8_000): Promise<boolean> {
  const trim = (path: string) => path.replace(/\/$/, "");
  const onPage = () => pathname === undefined || trim(location.pathname) === trim(pathname);
  const mentionsReview = (element: Element) =>
    /review/i.test(
      [
        element.getAttribute("placeholder"),
        element.getAttribute("aria-label"),
        element.getAttribute("name"),
        element.getAttribute("data-placeholder"),
      ].join(" "),
    );
  const labelOf = (element: Element) =>
    [
      element.getAttribute("aria-label"),
      ...(element.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/)
        .map((id) => (id ? document.getElementById(id)?.textContent : "")),
      element.querySelector("h1, h2, h3, h4, legend")?.textContent,
    ].join(" ");
  const editable = (element: HTMLElement) =>
    element instanceof HTMLTextAreaElement ? !element.disabled && !element.readOnly : element.isContentEditable;
  const holds = (box: HTMLElement) =>
    box instanceof HTMLTextAreaElement ? box.value === text : (box.textContent ?? "").includes(text);
  // A box counts when it names the review, or sits alone in a dialog titled for a review.
  const findBox = () => {
    const boxes = [...document.querySelectorAll<HTMLElement>("textarea, [contenteditable], [role='textbox']")].filter(
      editable,
    );
    const named = boxes.find(mentionsReview);
    if (named) return named;
    for (const dialog of document.querySelectorAll("dialog[open], [role='dialog']")) {
      if (!/review/i.test(labelOf(dialog))) continue;
      const inside = boxes.filter((box) => dialog.contains(box));
      if (inside.length === 1) return inside[0];
    }
    return undefined;
  };
  let opened = false;
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) {
    if (!onPage()) return false;
    const box = findBox();
    if (box) {
      box.focus();
      if (box instanceof HTMLTextAreaElement) {
        // React tracks the value through the prototype setter; an input event tells it the value changed.
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, text);
        box.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (!document.execCommand("insertText", false, text)) {
        return false;
      }
      return holds(box);
    }
    if (!opened) {
      const button = [...document.querySelectorAll<HTMLElement>("button, a, [role='button']")].find((element) =>
        /^\s*(rate\s*(&|and)\s*review|write\s+a\s+review|review)\s*$/i.test(element.textContent ?? ""),
      );
      if (button) {
        button.click();
        opened = true;
      }
    }
  }
  return false;
}
