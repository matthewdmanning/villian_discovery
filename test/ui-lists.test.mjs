import { expect, it } from "vitest";
import { createElement } from "../ui/node_modules/react/index.js";
import { renderToStaticMarkup } from "../ui/node_modules/react-dom/server.node.js";
import { QueryFields } from "../ui/src/components/TagQueryFields.tsx";
import { QuerySummary } from "../ui/src/components/TagSearch.tsx";
import { fixtureTags } from "./libby-lists-fixtures.ts";

it("displays the Libby names and the selected state", () => {
  const html = renderToStaticMarkup(
    createElement(QueryFields, {
      tags: fixtureTags,
      query: { includes: [["a", "c"]], excludes: [[]] },
      boolean: false,
      onChange() {},
    }),
  );
  expect(html).toContain("⭐ Favorite");
  expect(html).toContain("🎧 Audio");
  expect(html).toContain('aria-label="Add tag to Includes"');
  expect(html).toContain('aria-label="Remove ⭐ Favorite"');
  expect(html).toContain('aria-label="Remove 🎧 Audio"');
});

it("shows saved query groups with Libby names", async () => {
  const query = { includes: [["a", "b"], ["c"]], excludes: [["b"]] };
  const html = renderToStaticMarkup(createElement(QuerySummary, { query, tags: fixtureTags }));
  expect(html).toContain("(⭐ Favorite AND To read) OR 🎧 Audio");
  expect(html).toContain("Exclude");
});

it("sorts titles and authors without changing the original results", async () => {
  const { sortListItems } = await import("../ui/src/lib/list-results.ts");
  const books = [
    { id: "1", title: "Zulu", author: "Adams", tags: [] },
    { id: "2", title: "Alpha", author: "Zola", tags: [] },
    { id: "3", title: "Beta", tags: [] },
  ];
  expect(sortListItems(books, "title").map((item) => item.id)).toEqual(["2", "3", "1"]);
  expect(sortListItems(books, "author").map((item) => item.id)).toEqual(["1", "2", "3"]);
  expect(books[0].id).toBe("1");
});

it("shows library counts, wait and the right Libby actions", async () => {
  const { LibraryRows } = await import("../ui/src/components/ListResult.tsx");
  const rows = [
    {
      card: { cardId: "1", advantageKey: "first", library: { name: "First" } },
      status: "ok",
      media: {
        id: "42",
        title: "Book",
        isAvailable: true,
        ownedCopies: 5,
        availableCopies: 2,
        holdsCount: 3,
        estimatedWaitDays: 7,
      },
    },
    {
      card: { cardId: "2", advantageKey: "second" },
      status: "ok",
      media: { id: "42", title: "Book", isAvailable: false, isHoldable: true },
    },
    { card: { cardId: "3", advantageKey: "third" }, status: "error" },
  ];
  const html = renderToStaticMarkup(createElement(LibraryRows, { rows, titleId: "42", demo: false }));
  expect(html).toContain("3 / 5");
  expect(html).toContain("7 days");
  expect(html).toContain("Borrow at First in Libby");
  expect(html).toContain("Place hold at second in Libby");
  expect(html).toContain("Could not load");
});
