import { describe, expect, it } from "vitest";
import { matchesIsbnBook, matchesListSearch, parseSearchQuery } from "../ui/src/lib/search-query.ts";

const item = (overrides = {}) => ({
  id: "42",
  title: "Project Hail Mary",
  author: "Andy Weir",
  tags: ["read"],
  ...overrides,
});

describe("search query parsing", () => {
  it("preserves ordinary text and legacy book-line forms", () => {
    expect(parseSearchQuery("Project Hail Mary")).toEqual({
      raw: "Project Hail Mary",
      title: "Project Hail Mary",
      text: "Project Hail Mary",
      matchMode: "text",
    });
    // Plain text keeps the literal phrase alongside the legacy title-by-author reading.
    expect(parseSearchQuery("Project Hail Mary by Andy Weir")).toEqual({
      raw: "Project Hail Mary by Andy Weir",
      title: "Project Hail Mary",
      author: "Andy Weir",
      text: "Project Hail Mary by Andy Weir",
      matchMode: "text",
    });
    expect(parseSearchQuery("isbn:9780593135204")).toMatchObject({ isbn: "9780593135204" });
    expect(parseSearchQuery("id:42")).toMatchObject({ titleId: "42" });
  });

  it("parses title and author fields, individually or together", () => {
    expect(parseSearchQuery('title:"Project Hail Mary" author:"Andy Weir"')).toEqual({
      raw: 'title:"Project Hail Mary" author:"Andy Weir"',
      title: "Project Hail Mary",
      author: "Andy Weir",
      matchMode: "keywords",
    });
    expect(parseSearchQuery("title:Project Hail Mary author:Andy Weir")).toMatchObject({
      title: "Project Hail Mary",
      author: "Andy Weir",
    });
    expect(parseSearchQuery("author:Andy Weir")).toMatchObject({ raw: "author:Andy Weir", author: "Andy Weir" });
    expect(parseSearchQuery("title:'Project Hail Mary'")).toMatchObject({ title: "Project Hail Mary" });
  });

  it("preserves literal field names within quoted values and plain titles", () => {
    expect(parseSearchQuery('title:"The author: a memoir" author:Ng')).toMatchObject({
      title: "The author: a memoir",
      author: "Ng",
    });
    expect(parseSearchQuery("The author: a memoir")).toMatchObject({ title: "The author: a memoir" });
  });

  it("reports incomplete explicit fields", () => {
    expect(() => parseSearchQuery("title: author:Weir")).toThrow("Enter a value");
    expect(() => parseSearchQuery('title:"Hail Mary')).toThrow("Close the quote");
  });
});

describe("list search matching", () => {
  it("matches partial title or author keywords for plain text", () => {
    expect(matchesListSearch(item(), parseSearchQuery("hail"))).toBe(true);
    expect(matchesListSearch(item(), parseSearchQuery("weir"))).toBe(true);
    expect(matchesListSearch(item({ author: undefined }), parseSearchQuery("weir"))).toBe(false);
  });

  it("combines explicit title and author filters", () => {
    expect(matchesListSearch(item(), parseSearchQuery("title:hail author:weir"))).toBe(true);
    expect(matchesListSearch(item({ author: "Someone Else" }), parseSearchQuery("title:hail author:weir"))).toBe(false);
    expect(matchesListSearch(item({ title: "Other Book" }), parseSearchQuery("title:hail author:weir"))).toBe(false);
    expect(matchesListSearch(item(), parseSearchQuery("author:weir"))).toBe(true);
  });

  it("finds a literal title that also reads as title by author", () => {
    const chocolate = item({ title: "Death by Chocolate", author: "Sarah Graves" });
    expect(matchesListSearch(chocolate, parseSearchQuery("Death by Chocolate"))).toBe(true);
    expect(matchesListSearch(item(), parseSearchQuery("Project Hail Mary by Andy Weir"))).toBe(true);
    expect(matchesListSearch(item(), parseSearchQuery("Project Hail Mary by Someone Else"))).toBe(false);
  });

  it("tolerates small typos in plain text and in explicit fields", () => {
    expect(matchesListSearch(item(), parseSearchQuery("Projetc Hial Mary"))).toBe(true);
    expect(matchesListSearch(item(), parseSearchQuery("Andy Wier"))).toBe(true);
    expect(matchesListSearch(item(), parseSearchQuery("title:Hial author:Wier"))).toBe(true);
    expect(matchesListSearch(item(), parseSearchQuery("title:Hail author:Smith"))).toBe(false);
    expect(matchesListSearch(item(), parseSearchQuery("Martian"))).toBe(false);
  });

  it("uses IDs when present and does not invent ISBN metadata", () => {
    expect(matchesListSearch(item(), parseSearchQuery("id:42"))).toBe(true);
    expect(matchesListSearch(item({ id: "7" }), parseSearchQuery("id:42"))).toBe(false);
    expect(matchesListSearch(item(), parseSearchQuery("9780593135204"))).toBe(false);
    expect(matchesListSearch(item({ title: "9780593135204" }), parseSearchQuery("9780593135204"))).toBe(false);
  });
});

describe("ISBN book matching", () => {
  const book = (overrides = {}) => ({
    title: "Piranesi",
    authors: ["Susanna Clarke"],
    source: "open-library",
    ...overrides,
  });
  const piranesi = item({ title: "Piranesi", author: "Clarke, Susanna" });

  it("matches title and author, in either name order", () => {
    expect(matchesIsbnBook(piranesi, book())).toBe(true);
    expect(matchesIsbnBook(piranesi, book({ authors: ["Someone Else"] }))).toBe(false);
    expect(matchesIsbnBook(piranesi, book({ title: "Jonathan Strange" }))).toBe(false);
  });

  it("lets either side carry a subtitle the other lacks", () => {
    expect(matchesIsbnBook(piranesi, book({ subtitle: "A Novel" }))).toBe(true);
    expect(matchesIsbnBook(item({ title: "Piranesi: A Novel", author: "Susanna Clarke" }), book())).toBe(true);
  });

  it("never matches without an author to compare", () => {
    expect(matchesIsbnBook(item({ title: "Piranesi", author: undefined }), book())).toBe(false);
    expect(matchesIsbnBook(piranesi, book({ authors: [] }))).toBe(false);
  });
});
