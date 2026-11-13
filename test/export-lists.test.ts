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

it("fetchAllPages follows the query of each next link until next is null", async () => {
  const items = [1, 2, 3, 4, 5];
  const queries: unknown[] = [];
  const all = await fetchAllPages({ limit: 2, offset: 0 }, async (query) => {
    queries.push(query);
    const offset = Number(query.offset);
    const end = offset + Number(query.limit);
    const next = end < items.length ? `https://api.example/x/?limit=2&offset=${end}` : null;
    return { next, results: items.slice(offset, end) };
  });
  expect(all).toEqual(items);
  expect(queries).toEqual([
    { limit: 2, offset: 0 },
    { limit: "2", offset: "2" },
    { limit: "2", offset: "4" },
  ]);
});

it("fetchAllPages stops on an empty page even if next is set", async () => {
  let calls = 0;
  const all = await fetchAllPages({ offset: 0 }, async () => {
    calls++;
    return { next: "https://api.example/x/?offset=1", results: calls === 1 ? [1] : [] };
  });
  expect(all).toEqual([1]);
  expect(calls).toBe(2);
});
