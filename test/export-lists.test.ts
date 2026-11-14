import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  type FableGet,
  fetchAllPages,
  listFileNames,
  toBookEntry,
  waitForLogin,
  writeLists,
} from "../src/discovery/export-lists.js";
import { HttpError } from "../src/errors.js";
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

const status = (code: number) => new HttpError(`HTTP ${code}`, code, "/api/me/book-lists", undefined);
const page = <T>(results: T[]) => ({ next: null, results });

it("waitForLogin polls until the lists endpoint stops answering 401/403", async () => {
  const answers = [status(401), status(403)];
  const logs: string[] = [];
  const get = (async () => {
    const a = answers.shift();
    if (a) throw a;
    return page([]);
  }) as FableGet;
  await waitForLogin(get, { pollMs: 0, log: (m) => logs.push(m) });
  expect(answers).toEqual([]);
  expect(logs).toHaveLength(1);
});

it("waitForLogin rethrows non-auth errors and stops on timeout or a closed window", async () => {
  const fail = (e: Error) => (async () => Promise.reject(e)) as FableGet;
  await expect(waitForLogin(fail(status(500)), { pollMs: 0 })).rejects.toThrow("HTTP 500");
  await expect(waitForLogin(fail(status(401)), { pollMs: 0, timeoutMs: -1 })).rejects.toThrow("No login seen");
  await expect(waitForLogin(fail(status(401)), { isClosed: () => true })).rejects.toThrow("window was closed");
});

it("writeLists writes one libby-shelf book file per list", async () => {
  const get = (async (path: string) => {
    if (path === "/api/me/book-lists") return page([{ id: "a1", name: "Want to Read" }]);
    if (path === "/api/lists/a1/books")
      return page([{ book: { title: "Dune", authors: [{ name: "Frank Herbert" }] } }, { book: { title: "" } }, {}]);
    throw new Error(`unexpected ${path}`);
  }) as FableGet;
  const dir = await mkdtemp(join(tmpdir(), "fable-"));
  expect(await writeLists(get, dir)).toBe(1);
  expect(await readdir(dir)).toEqual(["want-to-read.json"]);
  const file = JSON.parse(await readFile(join(dir, "want-to-read.json"), "utf8"));
  expect(file).toEqual({ books: [{ title: "Dune", author: "Frank Herbert" }] });
});
