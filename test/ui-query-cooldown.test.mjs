// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYNC_FALLBACKS } from "../src/sync-config.ts";
import { act, createElement } from "../ui/node_modules/react/index.js";
import { createRoot } from "../ui/node_modules/react-dom/client.js";
import { demoApi } from "../ui/src/lib/api.ts";
import { StoreProvider, useStore } from "../ui/src/lib/store.tsx";
import { Cards } from "../ui/src/screens/Cards.tsx";
import { Shelf } from "../ui/src/screens/Shelf.tsx";
import { SyncScreen } from "../ui/src/screens/Sync.tsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
const tick = (ms) => act(async () => vi.advanceTimersByTime(ms));
const click = (el) => act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
/** The button whose stable visible label is `label`. */
const button = (label) => [...container.querySelectorAll("button")].find((el) => el.textContent.trim() === label);

async function mount(screen, api = {}) {
  const fake = {
    ...demoApi,
    cards: vi.fn(async () => [card]),
    shelf: vi.fn(async () => shelf),
    login: vi.fn(async () => {}),
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
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("refresh cooldown on screens", () => {
  it("counts down on Refresh cards and asks Libby again only once it ends", async () => {
    const api = await mount(Cards);
    const refresh = () => button("Refresh cards");
    expect(refresh().disabled).toBe(true);
    expect(refresh().textContent.trim()).toBe("Refresh cards");
    expect(refresh().getAttribute("title")).toBeNull();
    expect(refresh().hasAttribute("aria-describedby")).toBe(false);
    expect(container.textContent).not.toContain("Available again");
    await tick(9_000);
    expect(refresh().textContent.trim()).toBe("Refresh cards");
    await tick(1_000);
    expect(refresh().disabled).toBe(false);
    expect(refresh().textContent.trim()).toBe("Refresh cards");
    await click(refresh());
    expect(api.cards).toHaveBeenCalledTimes(2);
  });

  it("applies the cooldown to Retry after a failed card load", async () => {
    const api = await mount(Cards, {
      cards: vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue([card]),
    });
    expect(container.textContent).toContain("Could not load cards: down");
    expect(button("Retry").disabled).toBe(true);
    await tick(10_000);
    await click(button("Retry"));
    expect(api.cards).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Could not load cards");
  });

  it("reloads cards right after sign-in, cooldown or not", async () => {
    const api = await mount(Cards);
    expect(store.cardsCooldown).toBe(10);
    await act(async () => store.login({ method: "browser" }));
    expect(api.cards).toHaveBeenCalledTimes(2);
  });

  it("reloads cards after an externally observed account change despite a failed-load cooldown", async () => {
    const api = await mount(Cards, {
      cards: vi.fn().mockRejectedValueOnce(new Error("Sign in first")).mockResolvedValue([card]),
    });
    expect(store.cardsCooldown).toBe(10);
    await act(async () => store.refreshCards());
    expect(api.cards).toHaveBeenCalledTimes(1);
    await act(async () => store.forceRefreshCards());
    expect(api.cards).toHaveBeenCalledTimes(2);
    expect(store.cards).toEqual([card]);
    expect(store.cardsError).toBeUndefined();
  });

  it("gives the shelf a Refresh button with the same cooldown", async () => {
    const api = await mount(Shelf);
    expect(button("Refresh").disabled).toBe(true);
    await tick(10_000);
    await click(button("Refresh"));
    expect(api.shelf).toHaveBeenCalledTimes(2);
    expect(button("Refresh").disabled).toBe(true);
  });

  it("holds Preview changes for the cooldown after each preview", async () => {
    const api = await mount(SyncScreen);
    expect(api.previewSync).toHaveBeenCalledTimes(1);
    const preview = () => button("Preview changes");
    expect(preview().disabled).toBe(true);
    expect(preview().textContent.trim()).toBe("Preview changes");
    expect(preview().getAttribute("title")).toBeNull();
    expect(preview().hasAttribute("aria-describedby")).toBe(false);
    expect(container.textContent).not.toContain("Available again");
    await tick(10_000);
    expect(preview().disabled).toBe(false);
    await click(preview());
    expect(api.previewSync).toHaveBeenCalledTimes(2);
    expect(preview().disabled).toBe(true);
  });
});
