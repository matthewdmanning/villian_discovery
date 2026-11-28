// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYNC_FALLBACKS } from "../src/sync-config.ts";
import { act, createElement } from "../ui/node_modules/react/index.js";
import { createRoot } from "../ui/node_modules/react-dom/client.js";
import { LibraryCards as Cards } from "../ui/src/components/LibraryCards.tsx";
import { demoApi } from "../ui/src/lib/api.ts";
import { StoreProvider, useStore } from "../ui/src/lib/store.tsx";
import { Shelf } from "../ui/src/screens/Shelf.tsx";
import { SyncScreen } from "../ui/src/screens/Sync.tsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Repeated external reads are throttled by the server and extension caches; the screens never make users wait.
const card = { cardId: "1", cardName: "Main", advantageKey: "lib" };
const shelf = {
  checkedOut: { status: "available", items: [] },
  holds: { status: "available", items: [] },
  returned: { status: "unavailable", reason: "Not connected" },
};

let root;
let container;
let store;
function StoreProbe() {
  store = useStore();
  return null;
}
const flush = () => act(async () => {});
const click = (el) => act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const button = (label) => [...container.querySelectorAll("button")].find((el) => el.textContent.trim() === label);
function deferred() {
  let resolve;
  const promise = new Promise((yes) => (resolve = yes));
  return { promise, resolve };
}

async function mount(screen, api = {}) {
  const fake = {
    ...demoApi,
    cards: vi.fn(async () => [card]),
    shelf: vi.fn(async () => shelf),
    getSyncSettings: vi.fn(async () => ({ ...SYNC_FALLBACKS })),
    // The demo plan has every field the Sync screen renders.
    previewSync: vi.fn((options) => demoApi.previewSync(options)),
    ...api,
  };
  await act(async () => {
    root.render(createElement(StoreProvider, { api: fake }, createElement(screen), createElement(StoreProbe)));
  });
  await flush();
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

const plain = (el) => ({
  disabled: el.disabled,
  title: el.getAttribute("title"),
  describedBy: el.getAttribute("aria-describedby"),
});

describe("refresh buttons", () => {
  it("lets Refresh cards ask again as soon as a load finishes", async () => {
    const api = await mount(Cards);
    expect(plain(button("Refresh cards"))).toEqual({ disabled: false, title: null, describedBy: null });
    await click(button("Refresh cards"));
    await click(button("Refresh cards"));
    expect(api.cards).toHaveBeenCalledTimes(3);
  });

  it("retries a failed card load right away", async () => {
    const api = await mount(Cards, {
      cards: vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue([card]),
    });
    expect(container.textContent).toContain("Could not load cards: down");
    await click(button("Retry"));
    expect(api.cards).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Could not load cards");
  });

  it("reloads cards after an observed account change", async () => {
    const api = await mount(Cards);
    await act(async () => store.forceRefreshCards());
    expect(api.cards).toHaveBeenCalledTimes(2);
  });

  it("disables the shelf's Refresh only while the shelf loads", async () => {
    const next = deferred();
    const api = await mount(Shelf, { shelf: vi.fn().mockResolvedValueOnce(shelf).mockReturnValueOnce(next.promise) });
    expect(plain(button("Refresh"))).toEqual({ disabled: false, title: null, describedBy: null });
    await click(button("Refresh"));
    expect(api.shelf).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="status"]').textContent).toBe("Loading shelf…");
    await act(async () => next.resolve(shelf));
    expect(button("Refresh").disabled).toBe(false);
  });

  it("lets Sync run again as soon as a preview finishes", async () => {
    const api = await mount(SyncScreen);
    expect(api.previewSync).toHaveBeenCalledTimes(1);
    expect(plain(button("Sync"))).toEqual({ disabled: false, title: null, describedBy: null });
    await click(button("Sync"));
    expect(api.previewSync).toHaveBeenCalledTimes(2);
  });
});
