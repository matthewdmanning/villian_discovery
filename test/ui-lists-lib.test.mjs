import { describe, expect, it } from "vitest";
import { formatTagGroups, needsBoolean, simpleQuery, toggleTag, unionTags } from "../ui/src/lib/list-query.ts";
import { libbyTitleUrl, listLibraryDetails, sortListItems } from "../ui/src/lib/list-results.ts";

const tags = [
  { uuid: "a", name: "Favorites" },
  { uuid: "b", name: "To read" },
];

describe("list query helpers", () => {
  it("toggles a tag in and out without changing the original selection", () => {
    const selected = ["a"];
    expect(toggleTag(selected, "b")).toEqual(["a", "b"]);
    expect(toggleTag(selected, "a")).toEqual([]);
    expect(selected).toEqual(["a"]);
  });

  it("lists each tag once across groups", () => {
    expect(unionTags([["a", "b"], ["b"], []])).toEqual(["a", "b"]);
  });

  it("reduces a Boolean query to one AND group and one exclusion per tag", () => {
    expect(simpleQuery({ includes: [["a"], ["b", "a"]], excludes: [["a", "b"]] })).toEqual({
      includes: [["a", "b"]],
      excludes: [["a"], ["b"]],
    });
    expect(simpleQuery({ includes: [[]], excludes: [[]] })).toEqual({ includes: [[]], excludes: [] });
  });

  it("needs Boolean mode only for several include groups or an AND exclusion", () => {
    expect(needsBoolean({ includes: [["a", "b"]], excludes: [["a"], ["b"]] })).toBe(false);
    expect(needsBoolean({ includes: [["a"], []], excludes: [[]] })).toBe(false);
    expect(needsBoolean({ includes: [["a"], ["b"]], excludes: [] })).toBe(true);
    expect(needsBoolean({ includes: [["a"]], excludes: [["a", "b"]] })).toBe(true);
  });

  it("describes groups with tag names, bracketing AND groups only beside an OR", () => {
    expect(formatTagGroups([["a", "b"]], tags)).toBe("Favorites AND To read");
    expect(formatTagGroups([["a", "b"], ["b"]], tags)).toBe("(Favorites AND To read) OR To read");
    expect(formatTagGroups([["gone"]], tags)).toBe("gone");
    expect(formatTagGroups([[], []], tags)).toBe("—");
    expect(formatTagGroups([], tags)).toBe("—");
  });
});

describe("list result helpers", () => {
  it("sorts by author with untitled authors last, then title, then ID; case-insensitive", () => {
    const books = [
      { id: "3", title: "alpha", author: "adams", tags: [] },
      { id: "1", title: "Alpha", author: "Adams", tags: [] },
      { id: "2", title: "Beta", tags: [] },
      { id: "4", title: "Aardvark", author: "Zed", tags: [] },
    ];
    expect(sortListItems(books, "author").map((item) => item.id)).toEqual(["1", "3", "4", "2"]);
    expect(sortListItems(books, "title").map((item) => item.id)).toEqual(["4", "1", "3", "2"]);
  });

  it("derives checked-out copies and the Libby action from catalog data", () => {
    const ok = (media) => listLibraryDetails({ card: {}, status: "ok", media });
    expect(ok({ ownedCopies: 5, availableCopies: 2, isAvailable: true })).toEqual({
      checkedOut: 3,
      total: 5,
      action: "Borrow",
    });
    expect(ok({ ownedCopies: 5, availableCopies: 0, isAvailable: false, isHoldable: true })).toEqual({
      checkedOut: 5,
      total: 5,
      action: "Place hold",
    });
    expect(ok({ isAvailable: false, isHoldable: false }).action).toBeUndefined();
    // Impossible or missing counts still give two integers.
    expect(ok({ ownedCopies: 2, availableCopies: 5 })).toMatchObject({ checkedOut: 0, total: 2 });
    expect(ok({ ownedCopies: 2 })).toMatchObject({ checkedOut: 0, total: 2 });
    expect(ok({ ownedCopies: 2, isAvailable: false })).toMatchObject({ checkedOut: 2, total: 2 });
    expect(ok({ availableCopies: 3 })).toMatchObject({ checkedOut: 0, total: 0 });
    expect(ok(undefined)).toMatchObject({ checkedOut: 0, total: 0 });
  });

  it("offers no action for a library that failed or does not carry the title", () => {
    for (const status of ["error", "not-offered"]) {
      expect(listLibraryDetails({ card: {}, status, media: { isAvailable: true, isHoldable: true } }).action).toBe(
        undefined,
      );
    }
  });

  it("builds the Libby link with each part encoded", () => {
    expect(libbyTitleUrl("lib/1", "a b")).toBe("https://libbyapp.com/library/lib%2F1/everything/page-1/a%20b");
  });
});
