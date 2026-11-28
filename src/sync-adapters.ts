/**
 * Live, read-only sync adapters for Libby and Fable.
 *
 * Each adapter converts the app's native records into shared-schema snapshots. No write
 * operation is verified yet (see docs/sync-contracts.md), so both adapters report
 * `verified: false`, expose no writable fields, and refuse every write.
 */
import type { FableBook, FableGet, FableList } from "./discovery/export-lists.js";
import type { LibbyClient } from "./libby-client.js";
import { isbn13, normalizeName, normalizeTitle } from "./matcher.js";
import { fetchAllPages } from "./pagination.js";
import type { BookSnapshot, SnapshotField } from "./sync.js";
import type { SyncAdapter, SyncOperation } from "./sync-plan.js";
import type { ShelfItem, SyncResponse } from "./types.js";

/** One Fable list entry: the book with the user's reading data, plus the entry's note. */
export interface FableEntry {
  book?: FableBook & {
    id?: string;
    reading_progress?: { current_percentage?: number | null } | null;
    user_rating?: unknown;
  };
  note?: string | null;
}

/** POST a JSON body to a fable.co endpoint. Throws `HttpError` on a non-2xx status. */
export type FablePost = <T>(path: string, body: unknown) => Promise<T>;

/** One book in Fable's catalog search. */
interface FableSearchBook {
  id: string;
  title: string;
  isbn?: string;
  authors?: { name?: string }[];
}

const LIBBY_FIELDS = ["checkedOut", "readingProgress"] as const;
const FABLE_FIELDS = ["readingProgress", "readingStatus", "rating", "notes", "shelves"] as const;
const PAGE = { limit: 50, offset: 0 };
// Fable keeps `reading_progress.status` at "unread" for books on its Currently Reading list; the built-in list is the status.
const STATUS_BY_SYSTEM_LIST: Record<string, string> = {
  want_to_read: "want-to-read",
  current_reading: "currently-reading",
  finished: "finished",
  did_not_finish: "did-not-finish",
};
/** When a book sits on several system lists, the furthest-along status wins, whatever order Fable lists them in. */
const STATUS_RANK: Record<string, number> = {
  "want-to-read": 0,
  "currently-reading": 1,
  "did-not-finish": 2,
  finished: 3,
};
function furtherStatus(current: string | undefined, next: string | undefined): string | undefined {
  if (!next) return current;
  if (!current) return next;
  return (STATUS_RANK[next] ?? -1) > (STATUS_RANK[current] ?? -1) ? next : current;
}

/** Use this function to build a snapshot field only when the app returned a usable value. */
const field = (value: SnapshotField["value"] | undefined): SnapshotField | undefined =>
  value === undefined ? undefined : { value };

/** Use this function to drop fields the app did not return, so a missing value never reads as a cleared one. */
function present(fields: Record<string, SnapshotField | undefined>): Record<string, SnapshotField> {
  return Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, SnapshotField] => !!entry[1]));
}

/** Use this function to find the first ISBN among a Libby loan's formats. */
function loanIsbn(loan: ShelfItem): string | undefined {
  const formats = Array.isArray(loan.formats)
    ? (loan.formats as { identifiers?: { type: string; value: string }[] }[])
    : [];
  return formats.flatMap((format) => format.identifiers ?? []).find((id) => id.type === "ISBN")?.value;
}

/** Use this function to convert Libby's account state into snapshots: every current loan is a checked-out book. `progress` maps a loan ID to its percent read; a loan without an entry has unknown progress. */
export function libbySnapshots(state: SyncResponse, progress: ReadonlyMap<string, number> = new Map()): BookSnapshot[] {
  const books = new Map<string, BookSnapshot>();
  for (const loan of state.loans ?? []) {
    if (!loan.title) continue;
    const author = typeof loan.firstCreatorName === "string" ? loan.firstCreatorName : undefined;
    const isbn = loanIsbn(loan);
    const known = books.get(loan.id);
    if (known) {
      // The same title on another card is the same book: fill gaps, never add a second snapshot.
      if (!known.author && author) known.author = author;
      if (!known.isbn && isbn) known.isbn = isbn;
      continue;
    }
    const percent = progress.get(loan.id);
    books.set(loan.id, {
      bookId: `libby:${loan.id}`,
      title: loan.title,
      ...(author ? { author } : {}),
      ...(isbn ? { isbn } : {}),
      providerId: loan.id,
      fields: { checkedOut: { value: true }, ...present({ readingProgress: field(percent) }) },
    });
  }
  return [...books.values()];
}

/** Use this function to convert Fable list entries into snapshots; a book on several lists becomes one snapshot whose shelves name every list. */
export function fableSnapshots(lists: { list: FableList; entries: FableEntry[] }[]): BookSnapshot[] {
  const books = new Map<string, { snapshot: BookSnapshot; shelves: string[] }>();
  for (const { list, entries } of lists) {
    const status = STATUS_BY_SYSTEM_LIST[list.system_type ?? ""];
    for (const { book, note } of entries) {
      const id = book?.id;
      const title = book?.title?.trim();
      if (!id || !title) continue;
      const known = books.get(id);
      if (known) {
        if (!known.shelves.includes(list.name)) known.shelves.push(list.name);
        const current = known.snapshot.fields.readingStatus?.value;
        const best = furtherStatus(typeof current === "string" ? current : undefined, status);
        if (best) known.snapshot.fields.readingStatus = { value: best };
        // ponytail: Fable notes belong to a list entry; the first non-empty note stands for the book.
        if (!known.snapshot.fields.notes && note) known.snapshot.fields.notes = { value: note };
        continue;
      }
      const progress = book.reading_progress;
      const author = book.authors?.[0]?.name?.trim();
      const isbn = book.isbn?.trim() || book.display_isbn?.trim();
      books.set(id, {
        shelves: [list.name],
        snapshot: {
          bookId: `fable:${id}`,
          title,
          ...(author ? { author } : {}),
          ...(isbn ? { isbn } : {}),
          providerId: id,
          fields: present({
            readingProgress: field(progress?.current_percentage ?? undefined),
            readingStatus: field(status),
            rating: field(typeof book.user_rating === "number" ? book.user_rating : undefined),
            notes: field(note || undefined),
          }),
        },
      });
    }
  }
  return [...books.values()].map(({ snapshot, shelves }) => ({
    ...snapshot,
    fields: { ...snapshot.fields, shelves: { value: shelves } },
  }));
}

/** Use this function to refuse writes until a provider's write contract is verified. */
async function unverifiedWrite(): Promise<void> {
  throw new Error("Live writes are not verified for this app");
}

/** Use this function to find the one Fable catalog book for a Libby book: an ISBN match, else an exact title (and author) match. Throws when none or several fit, so no wrong book is ever added. */
async function findFableBook(get: FableGet, book: NonNullable<SyncOperation["create"]>): Promise<string> {
  const search = async (q: string) =>
    (await get<{ books?: FableSearchBook[] }>("/api/search", { q, type: "book" })).books ?? [];
  const wanted = book.isbn ? isbn13(book.isbn) : undefined;
  if (book.isbn && wanted) {
    const byIsbn = (await search(book.isbn)).filter(
      (candidate) => candidate.isbn !== undefined && isbn13(candidate.isbn) === wanted,
    );
    if (byIsbn.length === 1) return byIsbn[0]!.id;
  }
  const title = normalizeTitle(book.title, true);
  let candidates = (await search(book.title)).filter((candidate) => normalizeTitle(candidate.title, true) === title);
  if (candidates.length > 1 && book.author) {
    const author = normalizeName(book.author, true);
    candidates = candidates.filter((candidate) =>
      candidate.authors?.some((entry) => entry.name && normalizeName(entry.name, true) === author),
    );
  }
  if (candidates.length !== 1) throw new Error(`No single Fable book matches "${book.title}"`);
  return candidates[0]!.id;
}

/** Use this function to stand in for an app with no login: its schema is empty, so it reads nothing and receives nothing. */
export function disconnectedAdapter(): SyncAdapter {
  return { verified: false, fields: [], writableFields: [], read: async () => [], write: unverifiedWrite };
}

/** Use this function to read the signed-in Libby account's loans as a read-only sync adapter. */
export function libbyAdapter(client: LibbyClient): SyncAdapter {
  return {
    // Reads of loans and audiobook progress were checked against a live account on 2026-11-19; Libby is never written.
    verified: true,
    fields: LIBBY_FIELDS,
    writableFields: [],
    async read() {
      const state = await client.sync();
      const progress = new Map<string, number>();
      // A loan whose position cannot be read keeps unknown progress; it never reads as 0.
      await Promise.all(
        (state.loans ?? []).map(async (loan) => {
          const percent = await client
            .loanProgress({ cardId: loan.cardId, titleId: loan.id, mediaType: loan.type?.id ?? "" })
            .catch(() => undefined);
          // One title on several cards: keep the furthest position, independent of response order.
          if (percent !== undefined) progress.set(loan.id, Math.max(percent, progress.get(loan.id) ?? percent));
        }),
      );
      return libbySnapshots(state, progress);
    },
    write: unverifiedWrite,
  };
}

/**
 * Use this function to read every Fable list and its books. With `post`, it can also add a Libby book that Fable lacks
 * to Currently Reading (verified 2026-11-19 from fable.co's own search and list picker calls); no other write is verified.
 */
export function fableAdapter(get: FableGet, post?: FablePost): SyncAdapter {
  // One apply can add many books; read the list IDs once per adapter. A failed read is retried next time.
  let currentList: Promise<string> | undefined;
  const currentReadingId = () => {
    currentList ??= fetchAllPages({ ...PAGE, media_type: "" }, (query) =>
      get<{ next: string | null; results: FableList[] }>("/api/me/book-lists", query),
    ).then((lists) => {
      const current = lists.find((list) => list.system_type === "current_reading");
      if (!current) throw new Error("Fable has no Currently Reading list");
      return current.id;
    });
    currentList.catch(() => {
      currentList = undefined;
    });
    return currentList;
  };
  return {
    verified: !!post,
    fields: FABLE_FIELDS,
    writableFields: [],
    ...(post ? { createFields: ["readingStatus"] } : {}),
    async read() {
      const lists = await fetchAllPages({ ...PAGE, media_type: "" }, (query) =>
        get<{ next: string | null; results: FableList[] }>("/api/me/book-lists", query),
      );
      const withEntries = [];
      for (const list of lists) {
        const path = `/api/lists/${encodeURIComponent(list.id)}/books`;
        const entries = await fetchAllPages(PAGE, (query) =>
          get<{ next: string | null; results: FableEntry[] }>(path, query),
        );
        withEntries.push({ list, entries });
      }
      return fableSnapshots(withEntries);
    },
    async write(_context, operation, assertCurrent) {
      if (!post || !operation.create || operation.field !== "readingStatus" || operation.after !== "currently-reading")
        return unverifiedWrite();
      await assertCurrent();
      const listId = await currentReadingId();
      const bookId = await findFableBook(get, operation.create);
      await post("/api/me/book-lists/picker", { book_id: bookId, book_list_ids: [listId], exclude_from: [] });
    },
  };
}
