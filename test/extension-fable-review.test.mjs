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
    await expect(fillReview("A desert epic.", 500)).resolves.toBe(true);
    expect(box.value).toBe("A desert epic.");
    expect(input).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(box);
  });

  it("opens the review box with the page's Rate & review button", async () => {
    document.body.innerHTML = "<button>Rate &amp; review</button>";
    const open = vi.fn(() => {
      setTimeout(() => {
        document.body.insertAdjacentHTML("beforeend", '<div role="dialog"><textarea></textarea></div>');
      }, 100);
    });
    document.querySelector("button").addEventListener("click", open);
    await expect(fillReview("Good", 2_000)).resolves.toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[role=dialog] textarea").value).toBe("Good");
  });

  it("inserts text into an editable review area", async () => {
    document.body.innerHTML = '<div contenteditable="true" aria-label="Review"></div>';
    await expect(fillReview("Good", 500)).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("insertText", false, "Good");
  });

  it("gives up when the page has no review box, leaving other fields alone", async () => {
    document.body.innerHTML = '<textarea placeholder="Search"></textarea>';
    await expect(fillReview("Good", 300)).resolves.toBe(false);
    expect(document.querySelector("textarea").value).toBe("");
  });
});

describe("postToFable", () => {
  function stubChrome({ tabs = [] } = {}) {
    const listeners = new Set();
    const chrome = {
      tabs: {
        query: vi.fn(async () => tabs),
        update: vi.fn(async (id, change) => ({ id, ...change })),
        create: vi.fn(async (change) => ({ id: 9, ...change })),
        onUpdated: {
          addListener: (listener) => {
            listeners.add(listener);
            setTimeout(() => listener(9, { status: "complete" }));
            setTimeout(() => listener(5, { status: "complete" }));
          },
          removeListener: (listener) => listeners.delete(listener),
        },
      },
      windows: { update: vi.fn(async () => {}) },
      scripting: { executeScript: vi.fn(async () => [{ result: true }]) },
    };
    vi.stubGlobal("chrome", chrome);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => {}) }, configurable: true });
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
      args: ["Good"],
    });
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
