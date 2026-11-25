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

it("uses normalized authors, ignores ISBN editions, and keeps distinct authors apart", async () => {
  const { groupSearchResults } = await import("../ui/src/lib/search-results.ts");
  const match = (id, title, author, isbn) => ({
    card: { cardId: id, advantageKey: id },
    media: {
      id,
      title,
      firstCreatorName: author,
      ...(isbn && { formats: [{ id: "ebook", identifiers: [{ type: "ISBN", value: isbn }] }] }),
      type: { id: "ebook" },
    },
    titleScore: 1,
  });
  const groups = groupSearchResults(
    [
      match("one", "Dune", "Herbert, Frank", "9780441013593"),
      { ...match("two", "Dune", undefined), card: { cardId: "sparse", advantageKey: "sparse" } },
      match("two", "Dune", "Frank Herbert", "9781429954228"),
      match("three", "Dune", "Another Author"),
    ],
    [],
    ["ebook"],
  );
  expect(groups.map((group) => group.matches.map((row) => row.card.cardId))).toEqual([
    ["one", "sparse", "two"],
    ["three"],
  ]);
});

it("uses typed authors before firstCreatorName and safely falls back around narrators", async () => {
  const { mediaAuthors } = await import("../src/matcher.ts");
  expect(
    mediaAuthors({
      id: "typed",
      title: "Dune",
      firstCreatorName: "Ray Porter",
      creators: [
        { name: "Andy Weir", role: "Author" },
        { name: "Ray Porter", role: "Narrator" },
      ],
    }),
  ).toEqual(["Andy Weir"]);
  expect(
    mediaAuthors({
      id: "fallback",
      title: "Dune",
      firstCreatorName: "Andy Weir",
      creators: [{ name: "Ray Porter", role: "Narrator" }],
    }),
  ).toEqual(["Andy Weir"]);
  expect(
    mediaAuthors({
      id: "narrator",
      title: "Dune",
      firstCreatorName: "Ray Porter",
      creators: [{ name: "Ray Porter", role: "Narrator" }],
    }),
  ).toEqual([]);
});

it("keeps distinct explicit narrator credits in catalog order", async () => {
  const { mediaNarrators } = await import("../src/matcher.ts");
  expect(
    mediaNarrators({
      creators: [
        { name: "Wilkie Collins", role: "Author" },
        { name: "Ian Holm", role: " Narrator " },
        { name: " ian holm ", role: "narrator" },
        { name: "Simon Prebble", role: "NARRATOR" },
        { name: "Uncredited" },
        { name: "", role: "Narrator" },
        null,
      ],
    }),
  ).toEqual(["Ian Holm", "Simon Prebble"]);
  expect(mediaNarrators({})).toEqual([]);
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
