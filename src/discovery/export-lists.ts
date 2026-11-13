/**
 * Export the user's fable.co book lists as libby-shelf book files.
 *
 * Opens fable.co/library in the saved browser profile and waits for a login. Calls
 * the same cookie-authenticated `fable.co/api` endpoints the Library page uses, so
 * no token is read or stored. Each list is written as `{ "books": [{ title, author, isbn }] }`
 * (see `src/input.ts`).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { stripUndefined } from "../util.js";
import { launchInstalledBrowser } from "./capture.js";

const SITE = "https://fable.co";
export const LIBRARY_URL = `${SITE}/library`;
const PAGE_SIZE = 50;

export interface FableBook {
  title?: string;
  authors?: { name?: string }[];
  isbn?: string;
  display_isbn?: string;
}
export interface FableList {
  id: string;
  name: string;
}
interface Page<T> {
  next: string | null;
  results: T[];
}
type Query = Record<string, string | number>;

/** One fable book as a libby-shelf book entry; empty fields are omitted. */
export function toBookEntry(book: FableBook) {
  return stripUndefined({
    title: book.title?.trim() || undefined,
    author: book.authors?.[0]?.name?.trim() || undefined,
    isbn: book.isbn?.trim() || book.display_isbn?.trim() || undefined,
  });
}

/** File name per list id: the sanitized list name, plus the id when two names collide. */
export function listFileNames(lists: FableList[]): Map<string, string> {
  const used = new Set<string>();
  const names = new Map<string, string>();
  for (const { id, name } of lists) {
    const base =
      name
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "") || "list";
    const file = used.has(base) ? `${base}-${id}` : base;
    used.add(file);
    names.set(id, `${file}.json`);
  }
  return names;
}

/**
 * All results of a DRF-paginated endpoint: follows `next` until null.
 * fable.co's `next` links point at api.fable.co, which needs a token, so only their
 * query (`limit`, `offset`, …) is taken and sent back to the same fable.co path.
 */
export async function fetchAllPages<T>(first: Query, get: (query: Query) => Promise<Page<T>>): Promise<T[]> {
  const all: T[] = [];
  for (let query: Query | undefined = first; query; ) {
    const page: Page<T> = await get(query);
    all.push(...page.results);
    // An empty page ends the loop too, so a bad `next` cannot loop forever.
    query = page.next && page.results.length ? Object.fromEntries(new URL(page.next).searchParams) : undefined;
  }
  return all;
}

export interface ExportOptions {
  outDir: string;
  loginTimeoutMs?: number;
  log?: (message: string) => void;
}

/** Wait for the login, fetch every list and its books, and write one file per list. */
export async function exportLists(opts: ExportOptions): Promise<number> {
  const context = await launchInstalledBrowser();
  let closed = false;
  context.on("close", () => {
    closed = true;
  });
  try {
    const getJson = async <T>(path: string, query: Query): Promise<T> => {
      const url = new URL(path, SITE);
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
      // Playwright's error text includes the request's cookie header: drop it and keep no cause.
      const res = await context.request.get(url.href).catch(() => {
        throw new Error(
          closed ? "The browser window was closed before the export finished." : `Request failed: ${url.pathname}`,
        );
      });
      if (!res.ok()) throw new HttpStatusError(res.status(), url.pathname);
      return (await res.json()) as T;
    };
    const firstPage = { limit: PAGE_SIZE, offset: 0 };
    const listsFirstPage = { ...firstPage, media_type: "" };
    const listsPage = (query: Query) => getJson<Page<FableList>>("/api/me/book-lists", query);

    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(LIBRARY_URL).catch(() => {});
    const deadline = Date.now() + (opts.loginTimeoutMs ?? 10 * 60_000);
    let asked = false;
    // The lists endpoint answers 401/403 until the user logs in.
    for (;;) {
      if (closed) throw new Error("The browser window was closed before the export finished.");
      const status = await listsPage(listsFirstPage).then(
        () => 200,
        (e: unknown) => (e instanceof HttpStatusError && [401, 403].includes(e.status) ? e.status : Promise.reject(e)),
      );
      if (status === 200) break;
      if (Date.now() > deadline)
        throw new Error("No login seen. Log in to fable.co in the browser window, then try again.");
      if (!asked)
        opts.log?.("Log in to fable.co in the browser window. The tool continues on its own after you log in.");
      asked = true;
      await sleep(3_000);
    }

    const lists = await fetchAllPages(listsFirstPage, listsPage);
    const names = listFileNames(lists);
    await mkdir(opts.outDir, { recursive: true });
    for (const list of lists) {
      const path = `/api/lists/${encodeURIComponent(list.id)}/books`;
      const entries = await fetchAllPages(firstPage, (query) => getJson<Page<{ book?: FableBook }>>(path, query));
      const books = entries.flatMap((e) => (e.book ? [toBookEntry(e.book)] : [])).filter((b) => b.title || b.isbn);
      const file = join(opts.outDir, names.get(list.id)!);
      await writeFile(file, `${JSON.stringify({ books }, null, 2)}\n`);
      opts.log?.(`Saved "${list.name}" (${books.length} books) to ${file}`);
    }
    return lists.length;
  } finally {
    await context.close().catch(() => {});
  }
}

class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    super(`fable.co returned ${status} for ${path}`);
  }
}
