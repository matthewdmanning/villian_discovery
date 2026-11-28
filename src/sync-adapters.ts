/**
 * Live, read-only sync adapters for Libby and Fable.
 *
 * Each adapter converts the app's native records into shared-schema snapshots. No write
 * operation is verified yet (see docs/sync-contracts.md), so both adapters report
 * `verified: false`, expose no writable fields, and refuse every write.
 */
import type { FableBook, FableGet, FableList } from "./discovery/export-lists.js";
import { type CatalogReader, loanUrl, narratorsForItem } from "./libby-audiobooks.js";
import type { LibbyClient } from "./libby-client.js";
import { LOOKUP_CONCURRENCY, mapLimit } from "./map-limit.js";
import { isbn13, mediaNarrators, normalizeName, normalizeTitle } from "./matcher.js";
import { fetchAllPages } from "./pagination.js";
import { type BookSnapshot, type SnapshotField, syncEditionScore } from "./sync.js";
import type { FableCatalogMatch, SyncAdapter } from "./sync-plan.js";
import type { MediaFormat, ShelfItem, SyncResponse, ThunderMedia } from "./types.js";

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
interface FableSearchBook extends FableBook {
  id: string;
  title: string;
  subtitle?: string;
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

/** Use this function to map a provider's `value` (format label or object with id/name) to a book format. Dependencies are string normalization and the snapshot format vocabulary. */
function bookFormat(value: unknown): BookSnapshot["format"] {
  if (value && typeof value === "object") {
    const { id, name } = value as { id?: unknown; name?: unknown };
    return (
      bookFormat(typeof id === "string" ? id : undefined) ?? bookFormat(typeof name === "string" ? name : undefined)
    );
  }
  if (typeof value !== "string") return undefined;
  const label = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/^(audiobook|digitalaudio|audio$)/.test(label)) return "audiobook";
  if (/^(ebook|epub|kindle)/.test(label)) return "ebook";
  if (/^(print|physical|paperback|hardcover|hardback|massmarket)/.test(label)) return "print";
  if (label.startsWith("magazine")) return "magazine";
  return undefined;
}

/** Use this function to retain Fable's explicit format evidence for a `book`. A missing format stays unknown. Dependencies: `bookFormat`. */
function fableBookFormat(book: FableBook): BookSnapshot["format"] {
  return (
    bookFormat(book.format) ??
    bookFormat(book.book_format) ??
    bookFormat(book.media_type) ??
    (book.audiobook === true ? "audiobook" : undefined)
  );
}

/** Use this function to find an ISBN on the `item` formats for the known loan `format`. It uses `bookFormat` and `isbn13` to skip other editions and invalid identifiers. */
function loanIsbn(item: ShelfItem | ThunderMedia, format = bookFormat(item.type)): string | undefined {
  const formats = Array.isArray(item.formats) ? (item.formats as MediaFormat[]) : [];
  const eligible = formats.filter((entry) => entry && (!format || bookFormat(entry.id) === format));
  for (const entry of eligible) {
    for (const id of Array.isArray(entry.identifiers) ? entry.identifiers : []) {
      if (!/^isbn(?:-?1[03])?$/i.test(id?.type) || typeof id.value !== "string") continue;
      const isbn = isbn13(id.value);
      if (isbn) return isbn;
    }
  }
  return undefined;
}

/** Use this function to convert Libby's account state into snapshots: every current loan is a checked-out book. `progress` maps a loan ID to its percent read; a loan without an entry has unknown progress. */
export function libbySnapshots(state: SyncResponse, progress: ReadonlyMap<string, number> = new Map()): BookSnapshot[] {
  const books = new Map<string, BookSnapshot>();
  for (const loan of state.loans ?? []) {
    if (!loan.title) continue;
    const author = typeof loan.firstCreatorName === "string" ? loan.firstCreatorName : undefined;
    const format = bookFormat(loan.type);
    const isbn = loanIsbn(loan);
    const known = books.get(loan.id);
    if (known) {
      // The same title on another card is the same book: fill gaps, never add a second snapshot.
      if (!known.author && author) known.author = author;
      if (!known.isbn && isbn) known.isbn = isbn;
      if (!known.format && format) known.format = format;
      if (!known.loanUrl && state.cards?.some((card) => card.cardId === loan.cardId))
        known.loanUrl = loanUrl(loan.cardId, loan.id);
      continue;
    }
    const percent = progress.get(loan.id);
    books.set(loan.id, {
      bookId: `libby:${loan.id}`,
      title: loan.title,
      ...(author ? { author } : {}),
      ...(isbn ? { isbn } : {}),
      ...(format ? { format } : {}),
      providerId: loan.id,
      ...(state.cards?.some((card) => card.cardId === loan.cardId) ? { loanUrl: loanUrl(loan.cardId, loan.id) } : {}),
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
      const format = fableBookFormat(book);
      books.set(id, {
        shelves: [list.name],
        snapshot: {
          bookId: `fable:${id}`,
          title,
          ...(author ? { author } : {}),
          ...(isbn ? { isbn } : {}),
          ...(format ? { format } : {}),
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

/** Use this function to offer Fable editions for `book` (Libby title, author, and optional ISBN). Dependencies: `get`, `isbn13`, `fableBookFormat`, `syncEditionScore`, `normalizeTitle`, and `normalizeName`. */
async function searchFableBooks(
  get: FableGet,
  book: Pick<BookSnapshot, "title" | "author" | "isbn" | "format">,
  minTitleScore: number,
): Promise<FableCatalogMatch[]> {
  const search = async (q: string) =>
    (await get<{ books?: FableSearchBook[] }>("/api/search", { q, type: "book" })).books ?? [];
  const normalizeIsbn = (value: string | undefined) => value && isbn13(value);
  const isbn = normalizeIsbn(book.isbn);
  const fullTitle = normalizeTitle(book.title, false);
  const author = book.author && normalizeName(book.author, true);
  const [byIsbn, byTitle] = await Promise.all([
    isbn ? search(isbn) : [],
    search(book.title.split(/[:(]/, 1)[0]?.trim() || book.title),
  ]);
  const matches = new Map<string, FableCatalogMatch>();
  const scores = new Map<string, number>();
  const exactIsbns = new Set<string>();
  const exactWorks = new Set<string>();
  for (const candidate of [...byIsbn, ...byTitle]) {
    if (typeof candidate?.id !== "string" || !candidate.id || typeof candidate.title !== "string") continue;
    const candidateIsbn =
      typeof candidate.isbn === "string" && candidate.isbn.trim()
        ? candidate.isbn
        : typeof candidate.display_isbn === "string"
          ? candidate.display_isbn
          : undefined;
    const format = fableBookFormat(candidate);
    const subtitle =
      typeof candidate.subtitle === "string" && candidate.subtitle.trim() ? candidate.subtitle : undefined;
    const sameIsbn = isbn && isbn === normalizeIsbn(candidateIsbn);
    const score = syncEditionScore(book, {
      title: candidate.title,
      format,
      isbn: candidateIsbn,
      ...(subtitle ? { subtitle } : {}),
    });
    if (score === undefined || score < minTitleScore || score === 0) continue;
    const authors = (Array.isArray(candidate.authors) ? candidate.authors : []).flatMap((entry) =>
      typeof entry?.name === "string" && entry.name.trim() ? [entry.name.trim()] : [],
    );
    if (sameIsbn) exactIsbns.add(candidate.id);
    if (
      fullTitle &&
      book.format === format &&
      normalizeTitle(candidate.title, false) === fullTitle &&
      (!author || authors.some((name) => normalizeName(name, true) === author))
    )
      exactWorks.add(candidate.id);
    if (
      matches.has(candidate.id) &&
      ((scores.get(candidate.id) ?? 0) > score || (!format && matches.get(candidate.id)?.format))
    )
      continue;
    scores.set(candidate.id, score);
    matches.set(candidate.id, {
      id: candidate.id,
      title: candidate.title,
      ...(subtitle ? { subtitle } : {}),
      ...(format ? { format } : {}),
      ...(authors.length ? { author: authors.join(", ") } : {}),
      ...(candidateIsbn ? { isbn: candidateIsbn } : {}),
    });
  }
  const exact = exactIsbns.size ? exactIsbns : exactWorks;
  if (exact.size === 1) matches.get([...exact][0]!)!.automatic = true;
  return [...matches.values()].sort(
    (left, right) =>
      Number(exactIsbns.has(right.id)) - Number(exactIsbns.has(left.id)) ||
      Number(!!right.format) - Number(!!left.format) ||
      scores.get(right.id)! - scores.get(left.id)!,
  );
}

/** Use this function to stand in for an app with no login: its schema is empty, so it reads nothing and receives nothing. */
export function disconnectedAdapter(): SyncAdapter {
  return { verified: false, fields: [], writableFields: [], read: async () => [], write: unverifiedWrite };
}

/** Use this function to read the signed-in Libby account's loans as a read-only sync adapter. */
export function libbyAdapter(
  client: LibbyClient,
  observe?: (state: SyncResponse) => void,
  catalog?: CatalogReader,
): SyncAdapter {
  return {
    // Reads of loans and audiobook progress were checked against a live account on 2026-11-19; Libby is never written.
    verified: true,
    fields: LIBBY_FIELDS,
    writableFields: [],
    async read() {
      const state = await client.sync();
      observe?.(state);
      const progress = new Map<string, number>();
      const narrators = new Map<string, string[]>();
      const identifiers = new Map<string, string>();
      const cards = new Map(state.cards?.map((card) => [card.cardId, card]));
      // A loan whose position cannot be read keeps unknown progress; it never reads as 0.
      // Each loan may need a progress read and a catalog lookup; cap how many loans are in flight.
      await mapLimit(state.loans ?? [], LOOKUP_CONCURRENCY, async (loan) => {
        const card = cards.get(loan.cardId);
        const format = bookFormat(loan.type);
        const lookup =
          catalog && card?.advantageKey && !loanIsbn(loan)
            ? catalog.getLibraryMedia(card.advantageKey, loan.id).catch(() => undefined)
            : undefined;
        const [percent, credits] = await Promise.all([
          client
            .loanProgress({ cardId: loan.cardId, titleId: loan.id, mediaType: loan.type?.id ?? "" })
            .catch(() => undefined),
          lookup
            ? lookup.then((media) => {
                const checkedOut =
                  media?.id === loan.id && (!format || !media.type || bookFormat(media.type) === format)
                    ? media
                    : undefined;
                const isbn = checkedOut && loanIsbn(checkedOut, format);
                if (isbn) identifiers.set(loan.id, isbn);
                const direct = mediaNarrators(loan);
                return direct.length || !checkedOut || format !== "audiobook" ? direct : mediaNarrators(checkedOut);
              })
            : catalog
              ? narratorsForItem(loan, card, catalog)
              : [],
        ]);
        // One title on several cards: keep the furthest position, independent of response order.
        if (percent !== undefined) progress.set(loan.id, Math.max(percent, progress.get(loan.id) ?? percent));
        if (credits.length) narrators.set(loan.id, credits);
      });
      return libbySnapshots(state, progress).map((book) => {
        const credits = book.providerId && narrators.get(book.providerId);
        const isbn = book.providerId && identifiers.get(book.providerId);
        return { ...book, ...(isbn ? { isbn } : {}), ...(credits ? { narrators: credits } : {}) };
      });
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
    searchCatalog: (book, minTitleScore) => searchFableBooks(get, book, minTitleScore),
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
      const matches = await searchFableBooks(get, operation.create, operation.create.minTitleScore ?? 1);
      const { catalogId, catalogConfirmed } = operation.create;
      const book = matches.find(
        (candidate) => (!catalogId || candidate.id === catalogId) && (catalogConfirmed || candidate.automatic),
      );
      if (!book) throw new Error(`No confirmed Fable catalog edition for "${operation.create.title}"`);
      await assertCurrent();
      await post("/api/me/book-lists/picker", { book_id: book.id, book_list_ids: [listId], exclude_from: [] });
    },
  };
}
