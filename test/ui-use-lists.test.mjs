// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "../ui/node_modules/react/index.js";
import { createRoot } from "../ui/node_modules/react-dom/client.js";
import { demoApi } from "../ui/src/lib/api.ts";
import { StoreProvider } from "../ui/src/lib/store.tsx";
import { useLists } from "../ui/src/lib/use-lists.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const tags = [
  { uuid: "a", name: "A" },
  { uuid: "b", name: "B" },
];
const items = [
  { id: "1", title: "One", tags: ["a", "b"] },
  { id: "2", title: "Two", tags: ["a"] },
  { id: "3", title: "Three", tags: ["b"] },
];
const query = (includes, excludes = [[]]) => ({ includes, excludes });

let root;
let container;
let hook;
function Probe() {
  hook = useLists();
  return null;
}
async function mount() {
  const api = { ...demoApi, lists: vi.fn(async () => ({ tags, items })) };
  await act(async () => root.render(createElement(StoreProvider, { api }, createElement(Probe))));
  await act(async () => {});
}
const ids = () => hook.items.map((item) => item.id);

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

describe("useLists flags", () => {
  it("starts with both features off and reads each from its own flag", async () => {
    await mount();
    expect([hook.boolean, hook.multiquery]).toEqual([false, false]);
    await act(async () => root.unmount());
    localStorage.setItem("libby-shelf.feature.Boolean", "true");
    root = createRoot(container);
    await mount();
    expect([hook.boolean, hook.multiquery]).toEqual([true, false]);
  });

  it("remembers a changed flag for the next visit", async () => {
    await mount();
    await act(async () => hook.changeMultiquery(true));
    expect(localStorage.getItem("libby-shelf.feature.multiquery")).toBe("true");
    await act(async () => hook.changeMultiquery(false));
    expect(localStorage.getItem("libby-shelf.feature.multiquery")).toBe("false");
  });

  it("ignores any value other than the word true", async () => {
    localStorage.setItem("libby-shelf.feature.Boolean", "1");
    await mount();
    expect(hook.boolean).toBe(false);
  });
});

describe("useLists Boolean mode", () => {
  beforeEach(() => localStorage.setItem("libby-shelf.feature.Boolean", "true"));

  it("turning Boolean off folds OR groups into one AND group and splits exclusions", async () => {
    await mount();
    await act(async () => hook.setDraft(query([["a"], ["b"]], [["a", "b"]])));
    expect(ids()).toEqual(["2", "3"]);
    await act(async () => hook.changeBoolean(false));
    expect(ids()).toEqual([]);
    expect(hook.draft).toEqual({ includes: [["a", "b"]], excludes: [["a"], ["b"]] });
    expect(hook.boolean).toBe(false);
    expect(localStorage.getItem("libby-shelf.feature.Boolean")).toBe("false");
  });

  it("editing a saved search that needs Boolean turns Boolean back on", async () => {
    await mount();
    await act(async () => hook.changeMultiquery(true));
    await act(async () => hook.setDraft(query([["a"], ["b"]])));
    await act(async () => hook.add());
    await act(async () => hook.changeBoolean(false));
    expect(hook.boolean).toBe(false);
    await act(async () => hook.startEdit(hook.saved[0]));
    expect(hook.boolean).toBe(true);
    expect(localStorage.getItem("libby-shelf.feature.Boolean")).toBe("true");
  });

  it("editing a plain saved search leaves Boolean off", async () => {
    localStorage.removeItem("libby-shelf.feature.Boolean");
    await mount();
    await act(async () => hook.changeMultiquery(true));
    await act(async () => hook.setDraft(query([["a", "b"]])));
    await act(async () => hook.add());
    await act(async () => hook.startEdit(hook.saved[0]));
    expect(hook.boolean).toBe(false);
  });
});

describe("useLists saved searches", () => {
  beforeEach(() => localStorage.setItem("libby-shelf.feature.multiquery", "true"));

  it("saving an edit with no change is not a duplicate of itself", async () => {
    await mount();
    await act(async () => hook.setDraft(query([["a"]])));
    await act(async () => hook.add());
    await act(async () => hook.startEdit(hook.saved[0]));
    await act(async () => hook.saveEdit());
    expect(hook.duplicate).toBe(false);
    expect(hook.editing).toBeUndefined();
    expect(hook.saved).toHaveLength(1);
  });

  it("saves an edit that changes the results", async () => {
    await mount();
    await act(async () => hook.setDraft(query([["a"]])));
    await act(async () => hook.add());
    expect(ids()).toEqual(["1", "2"]);
    await act(async () => hook.startEdit(hook.saved[0]));
    await act(async () => hook.setEditing({ id: hook.saved[0].id, query: query([["b"]]) }));
    await act(async () => hook.saveEdit());
    expect(ids()).toEqual(["1", "3"]);
  });

  it("does nothing when saving without an edit in progress", async () => {
    await mount();
    await act(async () => hook.saveEdit());
    expect(hook.saved).toEqual([]);
  });

  it("gives each saved search its own id, even after one is removed", async () => {
    await mount();
    await act(async () => hook.setDraft(query([["a"]])));
    await act(async () => hook.add());
    await act(async () => hook.setDraft(query([["b"]])));
    await act(async () => hook.add());
    const [first, second] = hook.saved;
    expect(first.id).not.toBe(second.id);
    await act(async () => hook.setSaved(hook.saved.filter((row) => row.id !== first.id)));
    await act(async () => hook.setDraft(query([["a", "b"]])));
    await act(async () => hook.add());
    expect(new Set(hook.saved.map((row) => row.id)).size).toBe(2);
  });

  it("uses only the current search when the saved-search feature is off", async () => {
    await mount();
    await act(async () => hook.setDraft(query([["a"]])));
    await act(async () => hook.add());
    await act(async () => hook.changeMultiquery(false));
    await act(async () => hook.setDraft(query([["b"]])));
    expect(ids()).toEqual(["1", "3"]);
  });

  it("clears a stale duplicate warning and any edit when the feature is switched", async () => {
    await mount();
    await act(async () => hook.setDraft(query([["a"]])));
    await act(async () => hook.add());
    await act(async () => hook.setDraft(query([["a"]])));
    await act(async () => hook.add());
    expect(hook.duplicate).toBe(true);
    await act(async () => hook.startEdit(hook.saved[0]));
    await act(async () => hook.changeMultiquery(false));
    expect(hook.duplicate).toBe(false);
    expect(hook.editing).toBeUndefined();
  });
});

describe("useLists sorting", () => {
  it("sorts the filtered items and reuses them until an input changes", async () => {
    await mount();
    expect(hook.sorted.map((item) => item.id)).toEqual(["1", "3", "2"]);
    const before = hook.sorted;
    await act(async () => hook.setDuplicate(false));
    expect(hook.sorted).toBe(before);
    await act(async () => hook.setDraft(query([["b"]])));
    expect(hook.sorted.map((item) => item.id)).toEqual(["1", "3"]);
  });
});
