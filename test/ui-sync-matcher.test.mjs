import { describe, expect, it } from "vitest";
import { extractIsbn, hasExactIsbnMatch, normalizeIsbn, toStatusKey } from "../ui/src/screens/Sync.tsx";

describe("book matcher exact ISBN match", () => {
  it("normalizes ISBN-10 to ISBN-13 and matches candidate", () => {
    // 0593135202 -> 9780593135204
    expect(normalizeIsbn("0593135202")).toBe("9780593135204");
    expect(normalizeIsbn("978-0-593-13520-4")).toBe("9780593135204");

    const book = { title: "Project Hail Mary", isbn: "0593135202" };
    const candidates = [{ title: "Project Hail Mary", isbn: "978-0-593-13520-4" }];
    expect(hasExactIsbnMatch(book, candidates)).toBe(true);
  });

  it("extracts ISBN from bookId or workId when isbn field is absent", () => {
    expect(extractIsbn({ bookId: "isbn:9781635575637" })).toBe("9781635575637");
    expect(extractIsbn({ workId: "isbn:9780441172719" })).toBe("9780441172719");

    const book = { bookId: "isbn:9781635575637" };
    const candidates = [{ isbn: "978-1-63557-563-7" }];
    expect(hasExactIsbnMatch(book, candidates)).toBe(true);
  });

  it("returns false when candidate ISBN does not match", () => {
    const book = { title: "Dune", isbn: "9780441172719" };
    const candidates = [
      { title: "Dune Messiah", isbn: "9780441172696" },
      { title: "Dune (different edition)", isbn: "9780593099322" },
    ];
    expect(hasExactIsbnMatch(book, candidates)).toBe(false);
  });

  it("returns false when book has no ISBN", () => {
    const book = { title: "Unknown Book" };
    const candidates = [{ title: "Unknown Book", isbn: "9780441172719" }];
    expect(hasExactIsbnMatch(book, candidates)).toBe(false);
  });

  it("returns false when candidates have no ISBN", () => {
    const book = { title: "Dune", isbn: "9780441172719" };
    const candidates = [{ title: "Dune" }];
    expect(hasExactIsbnMatch(book, candidates)).toBe(false);
  });

  it("maps reading status strings to semantic status keys", () => {
    expect(toStatusKey("finished")).toBe("finished");
    expect(toStatusKey("currently-reading")).toBe("progress");
    expect(toStatusKey("dnf")).toBe("dnf");
    expect(toStatusKey("did-not-finish")).toBe("dnf");
    expect(toStatusKey("unopened")).toBe("unopened");
    expect(toStatusKey("other")).toBeUndefined();
  });
});
