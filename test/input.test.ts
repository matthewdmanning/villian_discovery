import { describe, expect, it } from "vitest";
import { normalizeIsbn, parseBookLine, parseBooks } from "../src/input.js";

describe("parseBookLine", () => {
  it.each([
    ["Project Hail Mary by Andy Weir", { title: "Project Hail Mary", author: "Andy Weir" }],
    ["Stand by Me by Some Author", { title: "Stand by Me", author: "Some Author" }],
    ["Dune - Frank Herbert", { title: "Dune", author: "Frank Herbert" }],
    ["Dune — Frank Herbert", { title: "Dune", author: "Frank Herbert" }],
    ["Dune | Frank Herbert", { title: "Dune", author: "Frank Herbert" }],
    ["Dune\tFrank Herbert", { title: "Dune", author: "Frank Herbert" }],
    ["Spider-Man", { title: "Spider-Man" }],
    ["isbn: 978-0-593-13520-4", { isbn: "9780593135204" }],
    ["0593135202", { isbn: "0593135202" }],
    ["id:5054011", { titleId: "5054011" }],
    ["https://libbyapp.com/library/lapl/everything/page-1/5054011", { titleId: "5054011" }],
    ["https://share.libbyapp.com/title/5054011", { titleId: "5054011" }],
  ])("%s", (line, expected) => {
    expect(parseBookLine(line)).toEqual({ raw: line, ...expected });
  });
});

describe("parseBooks", () => {
  it("text skips blanks and comments", () => {
    expect(parseBooks("# list\n\nDune\n  \nEmma by Jane Austen\n", "text").map((b) => b.title)).toEqual([
      "Dune",
      "Emma",
    ]);
  });

  it("json accepts strings, objects and {books}", () => {
    const books = parseBooks(
      JSON.stringify({
        books: ["Dune", { title: "Emma", author: "Jane Austen", format: "audiobook", action: "hold", libraries: "lib2" }],
      }),
      "json",
    );
    expect(books[1]).toMatchObject({ title: "Emma", mediaTypes: ["audiobook"], action: "hold", libraries: ["lib2"] });
  });

  it("json rejects entries with no identifier", () => {
    expect(() => parseBooks(JSON.stringify([{ author: "Nobody" }]), "json")).toThrow(/needs title/);
  });

  it("csv maps header aliases and list columns", () => {
    const csv = "Title,Author,ISBN,Format,Library\nDune,Frank Herbert,,ebook;audiobook,lib1|lib2\n,,978-0593135204,,\n";
    const books = parseBooks(csv, "csv");
    expect(books[0]).toMatchObject({ title: "Dune", mediaTypes: ["ebook", "audiobook"], libraries: ["lib1", "lib2"] });
    expect(books[1]).toMatchObject({ isbn: "9780593135204" });
  });
});

it("normalizeIsbn", () => {
  expect(normalizeIsbn("0-8044-2957-x")).toBe("080442957X");
  expect(normalizeIsbn("12345")).toBeUndefined();
});
