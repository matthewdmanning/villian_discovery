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
import type { BrowserContext } from "playwright-core";
import { HttpError } from "../errors.js";
import { stripUndefined } from "../util.js";
import { LOGIN_PROMPT, LOGIN_TIMEOUT_MS, openBrowserSession } from "./browser.js";

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
/** GET a fable.co JSON endpoint. Throws `HttpError` on a non-2xx status. */
export type FableGet = <T>(path: string, query: Query) => Promise<T>;

const FIRST_PAGE = { limit: PAGE_SIZE, offset: 0 };
const LISTS_FIRST_PAGE = { ...FIRST_PAGE, media_type: "" };
const WINDOW_CLOSED = "The browser window was closed before the export finished.";

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

const listsPage = (get: FableGet) => (query: Query) => get<Page<FableList>>("/api/me/book-lists", query);

export interface LoginWait {
  timeoutMs?: number;
  pollMs?: number;
  isClosed?: () => boolean;
  log?: (message: string) => void;
}

/** Polls the lists endpoint until it stops answering 401/403. */
export async function waitForLogin(get: FableGet, opts: LoginWait = {}): Promise<void> {
  const deadline = Date.now() + (opts.timeoutMs ?? LOGIN_TIMEOUT_MS);
  for (let asked = false; ; asked = true) {
    if (opts.isClosed?.()) throw new Error(WINDOW_CLOSED);
    try {
      await listsPage(get)(LISTS_FIRST_PAGE);
      return;
    } catch (e) {
      if (!(e instanceof HttpError && e.isAuthError)) throw e;
    }
    if (Date.now() > deadline)
      throw new Error("No login seen. Log in to fable.co in the browser window, then try again.");
    if (!asked) opts.log?.(`Log in to fable.co in the browser window. ${LOGIN_PROMPT}`);
    await sleep(opts.pollMs ?? 3_000);
  }
}

/** Fetches every list and its books, and writes one book file per list. Returns the list count. */
export async function writeLists(get: FableGet, outDir: string, log?: (message: string) => void): Promise<number> {
  const lists = await fetchAllPages(LISTS_FIRST_PAGE, listsPage(get));
  const names = listFileNames(lists);
  await mkdir(outDir, { recursive: true });
  for (const list of lists) {
    const path = `/api/lists/${encodeURIComponent(list.id)}/books`;
    const entries = await fetchAllPages(FIRST_PAGE, (query) => get<Page<{ book?: FableBook }>>(path, query));
    const books = entries.flatMap((e) => (e.book ? [toBookEntry(e.book)] : [])).filter((b) => b.title || b.isbn);
    const file = join(outDir, names.get(list.id)!);
    await writeFile(file, `${JSON.stringify({ books }, null, 2)}\n`);
    log?.(`Saved "${list.name}" (${books.length} books) to ${file}`);
  }
  return lists.length;
}

/** `FableGet` over the browser's cookies. Errors never carry the cookie header. */
function browserGet(context: BrowserContext, isClosed: () => boolean): FableGet {
  return async <T>(path: string, query: Query) => {
    const url = new URL(path, SITE);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    // Playwright's error text includes the request's cookie header: drop it and keep no cause.
    const res = await context.request.get(url.href).catch(() => {
      throw new Error(isClosed() ? WINDOW_CLOSED : `Request failed: ${url.pathname}`);
    });
    if (!res.ok())
      throw new HttpError(
        `fable.co returned ${res.status()} for ${url.pathname}`,
        res.status(),
        url.pathname,
        undefined,
      );
    return (await res.json()) as T;
  };
}

export interface ExportOptions {
  outDir: string;
  loginTimeoutMs?: number;
  log?: (message: string) => void;
}

/** Wait for the login, fetch every list and its books, and write one file per list. */
export async function exportLists(opts: ExportOptions): Promise<number> {
  const { context, page, isClosed } = await openBrowserSession();
  try {
    const get = browserGet(context, isClosed);
    await page.goto(LIBRARY_URL).catch(() => {});
    await waitForLogin(get, {
      isClosed,
      ...(opts.loginTimeoutMs !== undefined ? { timeoutMs: opts.loginTimeoutMs } : {}),
      ...(opts.log ? { log: opts.log } : {}),
    });
    return await writeLists(get, opts.outDir, opts.log);
  } finally {
    await context.close().catch(() => {});
  }
}
