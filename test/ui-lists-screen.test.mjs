// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "../ui/node_modules/react/index.js";
import { createRoot } from "../ui/node_modules/react-dom/client.js";
import { demoApi } from "../ui/src/lib/api.ts";
import { StoreProvider } from "../ui/src/lib/store.tsx";
import { SearchScreen } from "../ui/src/screens/Search.tsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const tags = [
  { uuid: "a", name: "Favorites" },
  { uuid: "b", name: "To read" },
  { uuid: "c", name: "Audio" },
];
const items = [
  { id: "1", title: "Zulu", author: "Adams", tags: ["a", "b"] },
  { id: "2", title: "Alpha", author: "Zola", tags: ["a"] },
  { id: "3", title: "Beta", tags: ["b", "c"] },
  { id: "4", title: "Gamma", author: "Moss", tags: [] },
];
const libraries = (titleId) => [
  {
    card: { cardId: "1", advantageKey: "first", library: { name: "First" } },
    status: "ok",
    media: { id: titleId, title: "T", isAvailable: true, ownedCopies: 5, availableCopies: 2, holdsCount: 0 },
  },
];

let root;
let container;
const flush = () => act(async () => {});
const text = () => container.textContent ?? "";
const titles = () => [...container.querySelectorAll("summary > span > span:first-child")].map((el) => el.textContent);
const click = (el) => act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const group = (name) =>
  [...container.querySelectorAll("fieldset")].find(
    (fieldset) => fieldset.querySelector("legend")?.textContent === name,
  );
const tagTrigger = (fieldset) => fieldset.querySelector('button[aria-haspopup="dialog"]');
const tagChoice = (label) =>
  [...container.querySelectorAll("dialog[open] button")].find((el) => el.textContent.trim() === label);
const pickTag = async (legend, label, section = group(legend)) => {
  await click(tagTrigger(section));
  await click(tagChoice(label));
  await click(tagChoice("Done"));
};
const removeTag = (legend, label, section = group(legend)) =>
  click(section.querySelector(`button[aria-label="Remove ${label}"]`));
const button = (label) => container.querySelector(`button[aria-label="${label}"]`);
const buttonText = (label) => [...container.querySelectorAll("button")].find((el) => el.textContent.trim() === label);

async function mount(api = {}) {
  const fake = {
    ...demoApi,
    lists: vi.fn(async () => ({ tags, items })),
    listAvailability: vi.fn(async (id) => libraries(id)),
    ...api,
  };
  await act(async () => {
    root.render(createElement(StoreProvider, { api: fake }, createElement(SearchScreen)));
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

describe("Lists screen", () => {
  it("shows every tagged title sorted by title, and by author on request", async () => {
    await mount();
    expect(titles()).toEqual(["Alpha", "Beta", "Gamma", "Zulu"]);
    const select = container.querySelector("select");
    await act(async () => {
      select.value = "author";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(titles()).toEqual(["Zulu", "Gamma", "Alpha", "Beta"]);
  });

  it("filters to titles with every included tag and drops excluded ones", async () => {
    await mount();
    await pickTag("Includes", "Favorites");
    expect(titles()).toEqual(["Alpha", "Zulu"]);
    await pickTag("Includes", "To read");
    expect(titles()).toEqual(["Zulu"]);
    await removeTag("Includes", "To read");
    await pickTag("Exclude", "To read");
    expect(titles()).toEqual(["Alpha"]);
  });

  it("excludes titles with any of the selected exclude tags", async () => {
    await mount();
    await pickTag("Exclude", "Favorites");
    await pickTag("Exclude", "Audio");
    expect(titles()).toEqual(["Gamma"]);
  });

  it("removes selected tags and keeps picker choices disjoint across Include/Exclude", async () => {
    await mount();
    await pickTag("Includes", "Favorites");
    await pickTag("Exclude", "To read");
    expect(group("Includes").textContent).toContain("Favorites");
    expect(group("Exclude").textContent).toContain("To read");

    await click(tagTrigger(group("Includes")));
    expect(tagChoice("Favorites")).toBeUndefined();
    expect(tagChoice("To read")).toBeUndefined();
    await click(container.querySelector('dialog button[aria-label="Close tag picker"]'));

    await removeTag("Includes", "Favorites");
    expect(group("Includes").textContent).not.toContain("Favorites");
    await click(tagTrigger(group("Exclude")));
    expect(tagChoice("To read")).toBeUndefined();
    expect(tagChoice("Favorites")).not.toBeUndefined();
    await click(container.querySelector('dialog button[aria-label="Close tag picker"]'));
  });

  it("shows the load error, then recovers when Refresh succeeds", async () => {
    const lists = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ tags, items });
    await mount({ lists });
    expect(container.querySelector('[role="alert"]').textContent).toContain("Could not load items");
    expect(titles()).toEqual([]);
    await click(buttonText("Refresh"));
    expect(lists).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(titles()).toHaveLength(4);
  });

  it("disables Refresh and shows progress while loading", async () => {
    let finish;
    const lists = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    await mount({ lists });
    expect(container.querySelector('[role="status"]').textContent).toBe("Loading…");
    expect(buttonText("Refresh").disabled).toBe(true);
    await act(async () => finish({ tags, items }));
    expect(titles()).toHaveLength(4);
  });

  it("lets Refresh ask again as soon as a load finishes", async () => {
    const api = await mount();
    const refresh = () => buttonText("Refresh");
    expect(refresh().disabled).toBe(false);
    expect(refresh().getAttribute("title")).toBeNull();
    await click(refresh());
    await click(refresh());
    expect(api.lists).toHaveBeenCalledTimes(3);
  });

  it("ignores a response that arrives after the screen is closed", async () => {
    let finish;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await mount({ lists: vi.fn(() => new Promise((resolve) => (finish = resolve))) });
    await act(async () => root.unmount());
    await act(async () => finish({ tags, items }));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    root = createRoot(container);
  });

  it("loads library availability once, on first open", async () => {
    const api = await mount();
    const details = container.querySelectorAll("details")[0];
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    await flush();
    expect(api.listAvailability).toHaveBeenCalledWith("2");
    expect(details.textContent).toContain("First");
    expect(details.textContent).toContain("3 / 5");
    await act(async () => {
      details.open = false;
      details.dispatchEvent(new Event("toggle"));
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(api.listAvailability).toHaveBeenCalledTimes(1);
  });

  it("shows an availability failure and retries only on request", async () => {
    const listAvailability = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(libraries("2"));
    await mount({ listAvailability });
    const details = container.querySelectorAll("details")[0];
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    await flush();
    expect(details.querySelector('[role="alert"]').textContent).toContain("Could not load libraries");
    await act(async () => {
      details.open = false;
      details.dispatchEvent(new Event("toggle"));
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(listAvailability).toHaveBeenCalledTimes(1);
    await click(details.querySelector("button.link"));
    expect(listAvailability).toHaveBeenCalledTimes(2);
    expect(details.querySelector('[role="alert"]')).toBeNull();
    expect(details.textContent).toContain("3 / 5");
  });

  it("refetches availability after a refresh", async () => {
    const api = await mount();
    await click(buttonText("Refresh"));
    const details = container.querySelectorAll("details")[0];
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(api.listAvailability).toHaveBeenCalledTimes(1);
  });
});

describe("Lists screen with saved searches", () => {
  beforeEach(() => localStorage.setItem("libby-shelf.feature.multiquery", "true"));
  const addQuery = () => click(button("Add query"));

  it("unions saved searches and ignores an empty unsaved one", async () => {
    await mount();
    await pickTag("Includes", "Favorites");
    await addQuery();
    expect(titles()).toEqual(["Alpha", "Zulu"]);
    await pickTag("Includes", "Audio");
    expect(titles()).toEqual(["Alpha", "Beta", "Zulu"]);
    await addQuery();
    expect(container.querySelectorAll('button[aria-label="Edit query"]')).toHaveLength(2);
    expect(titles()).toEqual(["Alpha", "Beta", "Zulu"]);
  });

  it("rejects an identical saved search, in any tag order, until it changes", async () => {
    await mount();
    await pickTag("Includes", "Favorites");
    await pickTag("Includes", "To read");
    await addQuery();
    await pickTag("Includes", "To read");
    await pickTag("Includes", "Favorites");
    await addQuery();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Identical to an existing search");
    expect(container.querySelectorAll('button[aria-label="Edit query"]')).toHaveLength(1);
    await pickTag("Includes", "Audio");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("edits a saved search, refuses to make it a duplicate, and cancels cleanly", async () => {
    await mount();
    await pickTag("Includes", "Favorites");
    await addQuery();
    await pickTag("Includes", "Audio");
    await addQuery();
    expect(titles()).toEqual(["Alpha", "Beta", "Zulu"]);

    await click(container.querySelectorAll('button[aria-label="Edit query"]')[1]);
    const editing = [...container.querySelectorAll("fieldset")].filter((fieldset) => fieldset.querySelector("legend"));
    const editingIncludes = editing
      .filter((fieldset) => fieldset.querySelector("legend")?.textContent === "Includes")
      .at(-1);
    await removeTag("Includes", "Audio", editingIncludes);
    await pickTag("Includes", "Favorites", editingIncludes);
    await click(button("Save query"));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Identical to an existing search");
    await click(button("Cancel editing query"));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(titles()).toEqual(["Alpha", "Beta", "Zulu"]);
  });

  it("removes a saved search and updates the results", async () => {
    await mount();
    await pickTag("Includes", "Audio");
    await addQuery();
    await pickTag("Includes", "Favorites");
    await addQuery();
    await click(container.querySelectorAll('button[aria-label="Remove query"]')[0]);
    expect(titles()).toEqual(["Alpha", "Zulu"]);
  });

  it("accepts an empty search, which matches every title", async () => {
    await mount();
    await addQuery();
    expect(container.querySelectorAll('button[aria-label="Edit query"]')).toHaveLength(1);
    expect(titles()).toHaveLength(4);
  });
});

describe("Lists screen with Boolean groups", () => {
  beforeEach(() => localStorage.setItem("libby-shelf.feature.Boolean", "true"));

  it("matches titles in any OR group and requires every tag within a group", async () => {
    await mount();
    const includes = group("Includes");
    await pickTag("Includes", "Favorites", includes);
    await pickTag("Includes", "To read", includes);
    expect(titles()).toEqual(["Zulu"]);
    await click([...includes.querySelectorAll("button")].find((el) => el.textContent === "Add OR group"));
    const second = group("Includes").querySelectorAll(":scope > div")[1];
    await pickTag("Includes", "Audio", second);
    expect(titles()).toEqual(["Beta", "Zulu"]);
    await click([...group("Includes").querySelectorAll("button")].find((el) => el.textContent === "Remove group"));
    // The first group (Favorites AND To read) is gone; only the Audio group remains.
    expect(titles()).toEqual(["Beta"]);
  });

  it("keeps the last group in place, so a query always has somewhere to add tags", async () => {
    await mount();
    expect([...group("Includes").querySelectorAll("button")].some((el) => el.textContent === "Remove group")).toBe(
      false,
    );
  });
});

describe("Lists screen persistence", () => {
  it("survives storage that throws", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await mount();
    expect(titles()).toHaveLength(4);
    get.mockRestore();
    set.mockRestore();
  });
});

describe("Unified search", () => {
  const match = (title, author = "Author") => ({
    card: { cardId: "1", advantageKey: "first", library: { name: "First" } },
    titleScore: 1,
    media: { id: title, title, author, type: { id: "ebook", name: "Ebook" }, isAvailable: true },
  });
  const submit = async (value) => {
    const input = container.querySelector('input[aria-label="Search books"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(buttonText("Search"));
    await flush();
  };

  it("passes plain text and author fields through catalog search", async () => {
    const search = vi.fn(async () => [match("Project Hail Mary", "Andy Weir")]);
    const api = await mount({ search });
    await submit("Project Hail Mary");
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ raw: "Project Hail Mary", title: "Project Hail Mary", matchMode: "text" }),
      expect.anything(),
    );
    await submit("author:Andy Weir");
    expect(search).toHaveBeenLastCalledWith(
      { raw: "author:Andy Weir", author: "Andy Weir", matchMode: "keywords" },
      expect.anything(),
    );
    expect(api.search).toHaveBeenCalledTimes(2);
    expect(text()).toContain("Project Hail Mary");
  });

  it("narrows tagged results by text and searches the catalog when the filter is removed", async () => {
    const search = vi.fn(async () => [match("Zulu, the biography")]);
    await mount({ search });
    await pickTag("Includes", "Favorites");
    await submit("adams");
    expect(titles()).toEqual(["Zulu"]);
    expect(search).not.toHaveBeenCalled();
    await removeTag("Includes", "Favorites");
    expect(search).toHaveBeenCalledTimes(1);
    expect(titles()).toEqual(["Zulu, the biography"]);
  });

  it("uses catalog title IDs to apply an ISBN query to a tagged list", async () => {
    const search = vi.fn(async () => [{ ...match("Zulu"), media: { ...match("Zulu").media, id: "1" } }]);
    await mount({ search });
    await pickTag("Includes", "Favorites");
    await submit("9780593135204");
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ isbn: "9780593135204" }), expect.anything());
    expect(titles()).toEqual(["Zulu"]);
  });
});
