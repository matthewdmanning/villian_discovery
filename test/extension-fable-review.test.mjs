// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fillReview, postToFable } from "../extension/src/fable-review.ts";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("fillReview", () => {
  beforeEach(() => {
    document.execCommand = vi.fn(() => true);
  });

  it("types into a visible review box the way a paste would", async () => {
    document.body.innerHTML = '<textarea placeholder="Write your review"></textarea>';
    const box = document.querySelector("textarea");
    const input = vi.fn();
    box.addEventListener("input", input);
    await expect(fillReview("A desert epic.", undefined, 500)).resolves.toBe(true);
    expect(box.value).toBe("A desert epic.");
    expect(input).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(box);
  });

  it("opens the review box with the page's Rate & review button", async () => {
    document.body.innerHTML = "<button>Rate &amp; review</button>";
    const open = vi.fn(() => {
      setTimeout(() => {
        document.body.insertAdjacentHTML(
          "beforeend",
          '<div role="dialog" aria-labelledby="t"><h2 id="t">Rate &amp; review</h2><textarea></textarea></div>',
        );
      }, 100);
    });
    document.querySelector("button").addEventListener("click", open);
    await expect(fillReview("Good", undefined, 2_000)).resolves.toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[role=dialog] textarea").value).toBe("Good");
  });

  it("inserts text into an editable review area", async () => {
    document.body.innerHTML = '<div contenteditable="true" aria-label="Review"></div>';
    const box = document.querySelector("div");
    Object.defineProperty(box, "isContentEditable", { value: true });
    document.execCommand = vi.fn(() => {
      box.textContent = "Good";
      return true;
    });
    await expect(fillReview("Good", undefined, 500)).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("insertText", false, "Good");
  });

  it("reports failure when the editor did not take the text", async () => {
    document.body.innerHTML = '<div contenteditable="true" aria-label="Review"></div>';
    Object.defineProperty(document.querySelector("div"), "isContentEditable", { value: true });
    document.execCommand = vi.fn(() => false);
    await expect(fillReview("Good", undefined, 300)).resolves.toBe(false);
  });

  it("skips a review-named element that cannot be edited", async () => {
    document.body.innerHTML = '<div role="textbox" aria-label="Review"></div>';
    await expect(fillReview("Good", undefined, 300)).resolves.toBe(false);
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it("leaves a draft in an unrelated dialog alone", async () => {
    document.body.innerHTML =
      '<div role="dialog" aria-label="Reply to comment"><textarea>My reply</textarea></div><button>Rate &amp; review</button>';
    await expect(fillReview("Good", undefined, 300)).resolves.toBe(false);
    expect(document.querySelector("textarea").value).toBe("My reply");
  });

  it("does nothing once the tab shows another page", async () => {
    document.body.innerHTML = '<textarea placeholder="Write your review"></textarea>';
    await expect(fillReview("Good", "/book/another", 300)).resolves.toBe(false);
    expect(document.querySelector("textarea").value).toBe("");
  });

  it("gives up when the page has no review box, leaving other fields alone", async () => {
    document.body.innerHTML = '<textarea placeholder="Search"></textarea>';
    await expect(fillReview("Good", undefined, 300)).resolves.toBe(false);
    expect(document.querySelector("textarea").value).toBe("");
  });
});

describe("postToFable", () => {
  // Each navigation finishes after a delay and reports the tab's URL, the way Chrome's tab events do.
  function stubChrome({ tabs = [], writeText = vi.fn(async () => {}) } = {}) {
    const listeners = new Set();
    const urls = new Map(tabs.map((tab) => [tab.id, undefined]));
    const navigate = (id, url) => {
      urls.set(id, url);
      setTimeout(() => {
        for (const listener of [...listeners]) listener(id, { status: "complete" }, { id, url: urls.get(id) });
      }, 20);
      return { id, url };
    };
    const chrome = {
      tabs: {
        query: vi.fn(async () => tabs),
        update: vi.fn(async (id, change) => ({ ...navigate(id, change.url), ...change })),
        create: vi.fn(async (change) => ({ ...navigate(9, change.url), ...change })),
        onUpdated: {
          addListener: (listener) => listeners.add(listener),
          removeListener: (listener) => listeners.delete(listener),
        },
      },
      windows: { update: vi.fn(async () => {}) },
      scripting: {
        executeScript: vi.fn(async ({ target }) => {
          chrome.scripting.pages.push(urls.get(target.tabId));
          return [{ result: true }];
        }),
        pages: [],
      },
    };
    vi.stubGlobal("chrome", chrome);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    return chrome;
  }
  const PAGE = "https://fable.co/book/dune-dune-1-by-frank-herbert-0441172717";

  it("copies the review, reuses the Fable tab and pastes into its page", async () => {
    const chrome = stubChrome({ tabs: [{ id: 5, windowId: 2 }] });
    await expect(postToFable(PAGE, "Good")).resolves.toBe("pasted");
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Good");
    expect(chrome.tabs.update).toHaveBeenCalledWith(5, { url: PAGE, active: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(2, { focused: true });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 5 },
      func: fillReview,
      args: ["Good", "/book/dune-dune-1-by-frank-herbert-0441172717"],
    });
  });

  it("runs two handoffs one after the other, each on its own book's page", async () => {
    const chrome = stubChrome({ tabs: [{ id: 5, windowId: 2 }] });
    const other = "https://fable.co/book/piranesi-by-susanna-clarke-163557563X";
    const results = await Promise.all([postToFable(PAGE, "Dune review"), postToFable(other, "Piranesi review")]);
    expect(results).toEqual(["pasted", "pasted"]);
    expect(chrome.scripting.pages).toEqual([PAGE, other]);
    expect(chrome.scripting.executeScript.mock.calls.map(([call]) => call.args)).toEqual([
      ["Dune review", new URL(PAGE).pathname],
      ["Piranesi review", new URL(other).pathname],
    ]);
  });

  it("asks for a manual copy when the clipboard refuses and no box took the text", async () => {
    const chrome = stubChrome({ writeText: vi.fn(async () => Promise.reject(new Error("Denied"))) });
    chrome.scripting.executeScript.mockResolvedValue([{ result: false }]);
    await expect(postToFable(PAGE, "Good")).resolves.toBe("manual");
  });

  it("opens a tab when none is open, and says the text was only copied when no box took it", async () => {
    const chrome = stubChrome();
    chrome.scripting.executeScript.mockResolvedValue([{ result: false }]);
    await expect(postToFable(PAGE, "Good")).resolves.toBe("copied");
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: PAGE });
  });

  it("refuses any page outside fable.co", async () => {
    const chrome = stubChrome();
    await expect(postToFable("https://evil.example/book", "Good")).rejects.toThrow("Not a Fable book page");
    expect(chrome.tabs.query).not.toHaveBeenCalled();
  });
});
