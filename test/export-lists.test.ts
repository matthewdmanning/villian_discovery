import { expect, it } from "vitest";
import { fetchAllPages, listFileNames, toBookEntry } from "../src/discovery/export-lists.js";
import { parseBooks } from "../src/input.js";

it("toBookEntry keeps title, first author and isbn, and omits empty fields", () => {
  expect(
    toBookEntry({ title: " Dune ", authors: [{ name: "Frank Herbert" }, { name: "X" }], isbn: "9780441013593" }),
  ).toEqual({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593" });
  expect(toBookEntry({ title: "Untitled", authors: [], isbn: "", display_isbn: "978-0-441-01359-3" })).toEqual({
    title: "Untitled",
    isbn: "978-0-441-01359-3",
  });
});

it("exported entries are valid libby-shelf input", () => {
  const books = [toBookEntry({ title: "Dune", authors: [{ name: "Frank Herbert" }] })];
  expect(parseBooks(JSON.stringify({ books }), "json")).toMatchObject([{ title: "Dune", author: "Frank Herbert" }]);
});

it("listFileNames sanitizes names and adds the id on collision", () => {
  const names = listFileNames([
    { id: "a1", name: "Want to Read" },
    { id: "b2", name: "want-to-read!" },
    { id: "c3", name: "../../etc" },
    { id: "d4", name: "★" },
    { id: "e5", name: "Café Reads" },
  ]);
  expect([...names.values()]).toEqual([
    "want-to-read.json",
    "want-to-read-b2.json",
    "etc.json",
    "list.json",
    "café-reads.json",
  ]);
});

it("fetchAllPages pages by offset until count is reached", async () => {
  const items = [1, 2, 3, 4, 5];
  const offsets: number[] = [];
  const all = await fetchAllPages(async (offset) => {
    offsets.push(offset);
    return { count: items.length, results: items.slice(offset, offset + 2) };
  });
  expect(all).toEqual(items);
  expect(offsets).toEqual([0, 2, 4]);
});

it("fetchAllPages stops on an empty page even if count is too high", async () => {
  const all = await fetchAllPages(async (offset) => ({ count: 99, results: offset ? [] : [1] }));
  expect(all).toEqual([1]);
});
