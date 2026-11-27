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

/** Product rules for Lists. */

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
  it("does not distinguish leading articles", () => {
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
  it("is two integers even when the catalog omits a count", () => {
    expect(cell({ id: "1", title: "T", ownedCopies: 5 })).toMatch(/^\d+ \/ \d+$/);
    expect(cell({ id: "1", title: "T", availableCopies: 2 })).toMatch(/^\d+ \/ \d+$/);
    expect(cell({ id: "1", title: "T" })).toMatch(/^\d+ \/ \d+$/);
  });
});

describe("all copies out vs. no copies owned", () => {
  const row = (status, media) => {
    const html = renderToStaticMarkup(
      createElement(LibraryRows, {
        rows: [{ card: { cardId: "1", advantageKey: "first" }, status, ...(media ? { media } : {}) }],
        titleId: "1",
        demo: false,
      }),
    );
    const container = document.createElement("div");
    container.innerHTML = html;
    return container.querySelector("tbody tr");
  };
  it("shows the counts, not grayed, when every copy is checked out", () => {
    const tr = row("ok", { id: "1", title: "T", ownedCopies: 3, availableCopies: 0, isHoldable: true });
    expect(tr.querySelector("td").textContent).toBe("3 / 3");
    expect(tr.getAttribute("aria-disabled")).toBeNull();
    expect(tr.querySelector("a")).not.toBeNull();
  });
  it("grays the row with no action when the library owns zero copies", () => {
    for (const tr of [row("ok", { id: "1", title: "T", ownedCopies: 0, isHoldable: true }), row("not-offered")]) {
      expect(tr.querySelector("td").textContent).toBe("0 / 0");
      expect(tr.getAttribute("aria-disabled")).toBe("true");
      expect(tr.className).toContain("opacity-50");
      expect(tr.textContent).toContain("Library owns no copies");
      expect(tr.querySelector("a")).toBeNull();
    }
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
  it("Boolean and multiquery are not shown as controls in the UI", async () => {
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
