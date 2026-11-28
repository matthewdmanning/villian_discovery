// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYNC_FALLBACKS } from "../src/sync-config.ts";
import { act, createElement } from "../ui/node_modules/react/index.js";
import { createRoot } from "../ui/node_modules/react-dom/client.js";
import { fableBookFor } from "../ui/src/components/PastCheckouts.tsx";
import { copyAndOpen } from "../ui/src/components/SyncReview.tsx";
import { demoApi } from "../ui/src/lib/api.ts";
import { screens } from "../ui/src/lib/spec.ts";
import { StoreProvider } from "../ui/src/lib/store.tsx";
import { loanTimeLeft, SyncScreen } from "../ui/src/screens/Sync.tsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DUNE_PAGE = "https://fable.co/book/dune-dune-1-by-frank-herbert-0441172717";
let root;
let container;

const flush = () => act(async () => {});
const settle = async () => {
  for (let i = 0; i < 20 && !container.querySelector('[role="tabpanel"][aria-label="Shelf"]'); i++)
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  // Short steps let React flush between loads that start one after another, like cards and then past checkouts.
  for (let i = 0; i < 12; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
};
const click = (el) => act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const button = (label) => [...container.querySelectorAll("button")].find((el) => el.textContent.trim() === label);
const line = (title) =>
  [...container.querySelectorAll('section[aria-label="Checked out"] li')].find((el) =>
    el.querySelector(".font-display")?.textContent.startsWith(title),
  );
function type(textarea, value) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

async function mount(props = {}, api = {}) {
  const fake = { ...demoApi, getSyncSettings: vi.fn(async () => ({ ...SYNC_FALLBACKS })), ...api };
  await act(async () => {
    root.render(createElement(StoreProvider, { api: fake }, createElement(SyncScreen, props)));
  });
  await settle();
  return fake;
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Sync screen layout", () => {
  it("comes first in the navigation as Sync, with its title for screen readers only", async () => {
    expect(screens[0]).toMatchObject({ id: "sync", title: "Sync" });
    await mount();
    const header = container.querySelector("#sync-title").closest("header");
    expect(header.className).toContain("sr-only");
    expect(container.querySelector('[role="tablist"]').className).toContain("tabs-lg");
    expect(button("Sync")).toBeTruthy();
    expect(button("Preview changes")).toBeUndefined();
  });

  it("shows only the simplified screens in the navigation", () => {
    expect(screens.map((s) => s.id)).toEqual(["sync", "shelf", "search", "player"]);
  });

  it("keeps library cards in the Settings tab", async () => {
    await mount();
    expect(container.textContent).not.toContain("Library cards");
    await click([...container.querySelectorAll('[role="tab"]')].find((el) => el.textContent === "Settings"));
    for (let i = 0; i < 10 && !container.querySelector('input[aria-label="Use Main"]'); i++) await flush();
    const panel = container.querySelector('[role="tabpanel"][aria-label="Settings"]');
    expect(panel.textContent).toContain("Your sync settings");
    expect(panel.textContent).toContain("Library cards");
    expect(panel.querySelector('input[aria-label="Use Main"]')).not.toBeNull();
  });

  it("shows author, narrator and days left under the title, and links both apps", async () => {
    await mount({ openLoan: vi.fn(async () => {}) });
    const dune = line("Dune");
    expect(dune.textContent).toContain("Frank Herbert · Narrated by Scott Brick · 9 days left");
    const fable = [...dune.querySelectorAll("a")].find((a) => a.textContent.startsWith("Open in Fable"));
    expect(fable.getAttribute("href")).toBe(DUNE_PAGE);
    expect(fable.getAttribute("target")).toBe("_blank");
  });

  it("says by the progress change when Fable progress cannot be written", async () => {
    const previewSync = vi.fn(async (options) => {
      const plan = await demoApi.previewSync(options);
      return {
        ...plan,
        operations: plan.operations.map((operation) =>
          operation.field === "readingProgress" ? { ...operation, blocked: "Fable progress is read-only" } : operation,
        ),
      };
    });
    await mount({}, { previewSync });
    const dune = line("Dune");
    expect(dune.textContent).toMatch(/\+80%\s*Blocked: Fable progress is read-only/);
    expect([...dune.querySelectorAll("details li")].some((li) => /progress/i.test(li.textContent))).toBe(false);
  });

  it("marks unsynced books in yellow without a badge, and drops the change once synced", async () => {
    await mount();
    expect(container.textContent).not.toContain("Needs sync");
    const dune = line("Dune");
    expect(dune.className).toContain("bg-warning/10");
    expect(dune.textContent).toContain("(needs sync)");
    expect(dune.textContent).toMatch(/\+80%/);
    // Progress shows on the line only, never in the pulldown.
    expect([...dune.querySelectorAll("details li")].some((li) => /progress/i.test(li.textContent))).toBe(false);

    for (const box of container.querySelectorAll('input[type="checkbox"]'))
      if (!box.checked && !box.disabled) await click(box);
    await click(button("Apply demo changes"));
    await settle();
    const synced = line("Dune");
    expect(synced.textContent).not.toMatch(/\+80%/);
    expect(synced.textContent).toContain("100%");
  });
});

describe("Fable review", () => {
  it("starts as one row and posts the text to the book's Fable page", async () => {
    const postReview = vi.fn(async () => "pasted");
    await mount({ postReview });
    const dune = line("Dune");
    const textarea = dune.querySelector("textarea");
    expect(textarea.getAttribute("rows")).toBe("1");
    expect(dune.querySelector("label").textContent).toBe("Review");
    const post = [...dune.querySelectorAll("button")].find((el) => el.textContent.startsWith("Post to Fable"));
    expect(post.disabled).toBe(true);
    await act(async () => type(textarea, "  A desert epic.  "));
    expect(post.disabled).toBe(false);
    await click(post);
    expect(postReview).toHaveBeenCalledExactlyOnceWith(DUNE_PAGE, "A desert epic.");
    expect(dune.querySelector('[role="status"]').textContent).toBe(
      "Pasted into Fable's review box. Check it, then post it on Fable.",
    );
  });

  it("keeps a draft through Sync, which unmounts the Shelf", async () => {
    await mount();
    await act(async () => type(line("Dune").querySelector("textarea"), "Half written"));
    await click(button("Sync"));
    await settle();
    expect(line("Dune").querySelector("textarea").value).toBe("Half written");
  });

  it("reports a failure to open Fable", async () => {
    await mount({ postReview: vi.fn(async () => Promise.reject(new Error("No tab"))) });
    const dune = line("Dune");
    await act(async () => type(dune.querySelector("textarea"), "Good"));
    await click([...dune.querySelectorAll("button")].find((el) => el.textContent.startsWith("Post to Fable")));
    expect(dune.querySelector('[role="status"]').textContent).toBe("Could not open Fable: No tab");
  });

  it("outside the extension, copies the review and opens the page", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await expect(copyAndOpen(DUNE_PAGE, "Good")).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith("Good");
    expect(open).toHaveBeenCalledWith(DUNE_PAGE, "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("outside the extension, asks for a manual copy when the clipboard refuses", async () => {
    const writeText = vi.fn(async () => Promise.reject(new Error("Denied")));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await expect(copyAndOpen(DUNE_PAGE, "Good")).resolves.toBe("manual");
    expect(open).toHaveBeenCalledOnce();
    open.mockRestore();
  });
});

describe("Past checkouts", () => {
  it("sits right below the checkouts, skips current loans and shows each book's Fable state", async () => {
    await mount();
    const sections = [...container.querySelectorAll("section[aria-label]")].map((el) => el.getAttribute("aria-label"));
    expect(sections.indexOf("Past checkouts")).toBe(sections.indexOf("Checked out") + 1);
    const list = container.querySelector('ul[aria-label="Past checkouts list"]');
    expect(list.className).toContain("max-h-[10.5rem]");
    expect(list.className).toContain("overflow-y-auto");
    const rows = [...list.querySelectorAll("li")];
    expect(rows.map((li) => li.querySelector(".font-display").textContent)).toEqual([
      "Piranesi",
      "Kindred",
      "The Left Hand of Darkness",
      "The Night Circus",
    ]);
    expect(rows[0].textContent).toContain("In Progress");
    expect(rows[0].querySelector("a").getAttribute("href")).toBe(
      "https://fable.co/book/piranesi-by-susanna-clarke-163557563X",
    );
    expect(rows[1].textContent).toContain("Not in Fable");
  });

  it("explains a missing Borrowed tag and retries a failed read", async () => {
    await mount({}, { pastCheckouts: vi.fn(async () => ({ status: "unavailable", reason: "No Borrowed tag." })) });
    expect(container.querySelector('section[aria-label="Past checkouts"]').textContent).toContain("No Borrowed tag.");

    await act(async () => root.unmount());
    root = createRoot(container);
    const pastCheckouts = vi
      .fn()
      .mockRejectedValueOnce(new Error("Libby is down"))
      .mockResolvedValue({ status: "available", source: "borrowed-tag", items: [] });
    await mount({}, { pastCheckouts });
    const section = container.querySelector('section[aria-label="Past checkouts"]');
    expect(section.textContent).toContain("Could not load past checkouts: Libby is down");
    await click([...section.querySelectorAll("button")].find((el) => el.textContent === "Retry"));
    await flush();
    expect(section.textContent).toContain("No past checkouts");
  });

  it("reloads with each Sync, so a new Borrowed title shows", async () => {
    const piranesi = { id: "1", title: "Piranesi", author: "Clarke, Susanna" };
    const kindred = { id: "2", title: "Kindred", author: "Butler, Octavia E." };
    const pastCheckouts = vi
      .fn()
      .mockResolvedValueOnce({ status: "available", source: "borrowed-tag", items: [piranesi] })
      .mockResolvedValue({ status: "available", source: "borrowed-tag", items: [kindred, piranesi] });
    await mount({}, { pastCheckouts });
    const titles = () =>
      [...container.querySelectorAll('ul[aria-label="Past checkouts list"] .font-display')].map((el) => el.textContent);
    expect(titles()).toEqual(["Piranesi"]);
    await click(button("Sync"));
    await settle();
    expect(pastCheckouts).toHaveBeenCalledTimes(2);
    expect(titles()).toEqual(["Kindred", "Piranesi"]);
  });

  it("matches Libby's sort names to Fable authors", () => {
    const fable = [{ bookId: "fable:1", title: "Piranesi: A Novel", author: "Susanna Clarke", fields: {} }];
    expect(fableBookFor({ title: "Piranesi", author: "Clarke, Susanna" }, fable)).toBe(fable[0]);
    expect(fableBookFor({ title: "Piranesi", author: "Seghers, Pierre" }, fable)).toBeUndefined();
  });
});

describe("loanTimeLeft", () => {
  const now = Date.parse("2026-11-28T12:00:00Z");
  it("counts whole days left, and says when a loan is due today", () => {
    expect(loanTimeLeft("2026-12-07T11:00:00Z", now)).toBe("9 days left");
    expect(loanTimeLeft("2026-11-29T11:00:00Z", now)).toBe("1 day left");
    expect(loanTimeLeft("2026-11-28T11:00:00Z", now)).toBe("Due today");
    expect(loanTimeLeft(undefined, now)).toBeUndefined();
    expect(loanTimeLeft("soon", now)).toBeUndefined();
  });
});
