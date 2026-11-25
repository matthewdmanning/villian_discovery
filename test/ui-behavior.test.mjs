import { expect, it } from "vitest";
import { parseBookDraft } from "../ui/src/lib/books.ts";
import { cardSelected, libraryOrder, toggleCard } from "../ui/src/lib/cards.ts";

const cards = [
  { cardId: "one", advantageKey: "library", cardName: "Main" },
  { cardId: "two", advantageKey: "library", cardName: "Other" },
  { cardId: "three", advantageKey: "branch", cardName: "Branch" },
];
it("keeps the last card selected instead of interpreting none as all", () => {
  const selected = toggleCard(cards, ["one"], cards[0], false);
  expect(selected).toEqual(["one"]);
  expect(cards.map((card) => cardSelected(selected, card))).toEqual([true, false, false]);
  expect(cardSelected(["MAIN"], cards[0])).toBe(true);
});
it("lists each library once while preserving priority", () => {
  expect(libraryOrder(cards, [])).toEqual(["library", "branch"]);
  expect(libraryOrder(cards, ["BRANCH", "branch", "missing"])).toEqual(["branch", "library"]);
});
it("detects both supported pasted JSON forms and preserves text parsing", () => {
  for (const text of ['{"books":[{"title":"Dune"}]}', '[{"title":"Dune"}]']) {
    expect(parseBookDraft(text, "auto").books).toMatchObject([{ title: "Dune" }]);
  }
  expect(parseBookDraft("Dune by Frank Herbert", "auto").books).toMatchObject([
    { title: "Dune", author: "Frank Herbert" },
  ]);
  expect(parseBookDraft('{"books":', "auto").error).toMatch(/JSON/);
});

it("groups search editions by title and author and orders availability before preferences", async () => {
  const { groupSearchResults } = await import("../ui/src/lib/search-results.ts");
  const match = (title, author, library, type, available) => ({
    card: { cardId: library, advantageKey: library },
    media: { id: `${library}-${type}`, title, firstCreatorName: author, type: { id: type }, isAvailable: available },
    titleScore: 1,
  });
  const rows = [
    match("Dune", "Frank Herbert", "first", "ebook", false),
    match(" dune ", "FRANK HERBERT", "second", "audiobook", true),
    match("Dune", "Frank Herbert", "first", "audiobook", true),
    match("Dune", "Another Author", "first", "ebook", true),
    match("Dune", undefined, "first", "ebook", true),
    match("Dune", undefined, "second", "ebook", true),
  ];
  const groups = groupSearchResults(rows, ["first", "second"], ["ebook", "audiobook"]);
  expect(groups).toHaveLength(4);
  expect(groups[0].matches.map((row) => `${row.card.advantageKey}-${row.media.type.id}`)).toEqual([
    "first-audiobook",
    "second-audiobook",
    "first-ebook",
  ]);
});

it("filters library options before sorting books and keeps their priority order", async () => {
  const { filterSearchGroups } = await import("../ui/src/lib/search-results.ts");
  const option = (library, type, available) => ({
    card: { cardId: library, advantageKey: library },
    media: { id: library, title: "", type: { id: type }, isAvailable: available },
    titleScore: 1,
  });
  const groups = [
    {
      key: "z",
      title: "Zulu",
      author: "Adams",
      matches: [option("main", "ebook", false), option("branch", "audiobook", true)],
    },
    {
      key: "a",
      title: "Alpha",
      author: "Baker",
      matches: [option("main", "ebook", true), option("branch", "ebook", true)],
    },
  ];
  const filters = { availability: "all", format: "", library: "", sort: "available" };
  expect(filterSearchGroups(groups, filters).map((g) => g.title)).toEqual(["Zulu", "Alpha"]);
  const onlyMainAvailable = filterSearchGroups(groups, { ...filters, availability: "available", library: "main" });
  expect(onlyMainAvailable.map((g) => g.title)).toEqual(["Alpha"]);
  expect(onlyMainAvailable[0].matches.map((m) => m.card.advantageKey)).toEqual(["main"]);
  expect(filterSearchGroups(groups, { ...filters, format: "audiobook" })[0].matches).toHaveLength(1);
  expect(filterSearchGroups(groups, { ...filters, sort: "title" }).map((g) => g.title)).toEqual(["Alpha", "Zulu"]);
  expect(filterSearchGroups(groups, { ...filters, sort: "author" }).map((g) => g.title)).toEqual(["Zulu", "Alpha"]);
  expect(groups[0].matches).toHaveLength(2);
});
