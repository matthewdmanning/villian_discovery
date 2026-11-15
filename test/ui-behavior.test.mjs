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
