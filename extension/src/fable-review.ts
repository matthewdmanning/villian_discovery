/** How a review reached Fable: typed into the page's review box, or only copied for the user to paste. */
export type ReviewDelivery = "pasted" | "copied";

const LOAD_MS = 20_000;

/**
 * Open `pageUrl` in the Fable tab (or a new one) and paste `text` into the book's review box.
 * The text is copied first, so the user can paste it when Fable's page has no box this finds.
 * Nothing is submitted: the user reviews and posts on Fable.
 */
export async function postToFable(pageUrl: string, text: string): Promise<ReviewDelivery> {
  const url = new URL(pageUrl);
  if (url.protocol !== "https:" || url.hostname !== "fable.co") throw new Error("Not a Fable book page");
  await navigator.clipboard.writeText(text).catch(() => undefined);
  const [existing] = await chrome.tabs.query({ url: "https://fable.co/*" });
  const tab = existing?.id
    ? await chrome.tabs.update(existing.id, { url: url.href, active: true })
    : await chrome.tabs.create({ url: url.href });
  if (tab?.id === undefined) return "copied";
  if (existing) await chrome.windows.update(existing.windowId, { focused: true });
  await loaded(tab.id);
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fillReview, args: [text] });
  return result?.result === true ? "pasted" : "copied";
}

/** Resolve once the tab finishes loading, or after `LOAD_MS`. */
function loaded(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id: number, change: { status?: string }) => {
      if (id === tabId && change.status === "complete") done();
    };
    const timer = setTimeout(done, LOAD_MS);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Runs in the Fable page. Find the review box, opening it with the page's review button when needed,
 * and type `text` into it the way a paste would. Returns whether a box took the text.
 * Self-contained: `chrome.scripting` serializes this function, so it may use nothing from this module.
 */
export async function fillReview(text: string, timeoutMs = 8_000): Promise<boolean> {
  const mentionsReview = (element: Element) =>
    /review/i.test(
      [
        element.getAttribute("placeholder"),
        element.getAttribute("aria-label"),
        element.getAttribute("name"),
        element.getAttribute("data-placeholder"),
      ].join(" "),
    );
  const findBox = () =>
    [...document.querySelectorAll<HTMLElement>("textarea, [contenteditable='true'], [role='textbox']")].find(
      mentionsReview,
    ) ?? document.querySelector<HTMLElement>("dialog textarea, [role='dialog'] textarea");
  let opened = false;
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) {
    const box = findBox();
    if (box) {
      box.focus();
      if (box instanceof HTMLTextAreaElement) {
        // React tracks the value through the prototype setter; an input event tells it the value changed.
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, text);
        box.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        document.execCommand("insertText", false, text);
      }
      return true;
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
