// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "../ui/node_modules/react/index.js";
import { createRoot } from "../ui/node_modules/react-dom/client.js";
import { renderToStaticMarkup } from "../ui/node_modules/react-dom/server.node.js";
import { LibraryRows } from "../ui/src/components/ListResult.tsx";
import { demoApi } from "../ui/src/lib/api.ts";
import { sortListItems } from "../ui/src/lib/list-results.ts";
import { StoreProvider } from "../ui/src/lib/store.tsx";
import { TagsScreen } from "../ui/src/screens/Tags.tsx";

/**
 * Product rules for Lists. `it.fails` marks a rule the code does not yet meet: CI stays green, and the test
 * starts failing as soon as the rule is met, which is the cue to change `it.fails` to `it`.
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const titlesOf = (items) => sortListItems(items, "title").map((item) => item.title);
const book = (title) => ({ id: title, title, tags: [] });

describe("title sort", () => {
  it("does not distinguish case", () => {
    expect(titlesOf([book("beta"), book("Alpha"), book("GAMMA"), book("alpha")]).map((t) => t.toLowerCase())).toEqual([
      "alpha",
      "alpha",
      "beta",
      "gamma",
    ]);
  });
  it.fails("does not distinguish leading articles", () => {
    expect(titlesOf([book("The Zebra"), book("A Gamma"), book("An Apple"), book("Beta")])).toEqual([
      "An Apple",
      "Beta",
      "A Gamma",
      "The Zebra",
    ]);
  });
});

describe("Available column", () => {
  const cell = (media) => {
    const html = renderToStaticMarkup(
      createElement(LibraryRows, {
        rows: [{ card: { cardId: "1", advantageKey: "first" }, status: "ok", media }],
        titleId: "1",
        demo: false,
      }),
    );
    const container = document.createElement("div");
    container.innerHTML = html;
    return container.querySelector("tbody td").textContent;
  };
  it("is two integers separated by a slash when the catalog gives both counts", () => {
    expect(cell({ id: "1", title: "T", ownedCopies: 5, availableCopies: 2 })).toMatch(/^\d+ \/ \d+$/);
    expect(cell({ id: "1", title: "T", ownedCopies: 0, availableCopies: 0 })).toMatch(/^\d+ \/ \d+$/);
  });
  it.fails("is two integers even when the catalog omits a count", () => {
    expect(cell({ id: "1", title: "T", ownedCopies: 5 })).toMatch(/^\d+ \/ \d+$/);
  });
});

describe("feature flags", () => {
  let root;
  let container;
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
  const render = async () => {
    const api = { ...demoApi, lists: vi.fn(async () => ({ tags: [], items: [] })) };
    await act(async () => root.render(createElement(StoreProvider, { api }, createElement(TagsScreen))));
  };
  it.fails("Boolean and multiquery are not shown as controls in the UI", async () => {
    await render();
    expect(container.textContent).not.toMatch(/Boolean|multiquery/);
    expect(container.querySelectorAll("input.toggle")).toHaveLength(0);
  });
  it("a flag turns its behavior on without any visible control", async () => {
    localStorage.setItem("libby-shelf.feature.multiquery", "true");
    await render();
    expect(container.querySelector('button[aria-label="Add query"]')).not.toBeNull();
  });
  it("behavior stays off when its flag is not set", async () => {
    await render();
    expect(container.querySelector('button[aria-label="Add query"]')).toBeNull();
    expect(container.textContent).not.toContain("Add OR group");
  });
});
