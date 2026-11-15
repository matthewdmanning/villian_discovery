/**
 * Live, read-only sync adapters for Libby and Fable.
 *
 * Each adapter converts the app's native records into shared-schema snapshots. No write
 * operation is verified yet (see docs/sync-contracts.md), so both adapters report
 * `verified: false`, expose no writable fields, and refuse every write.
 */
import { type FableBook, type FableGet, type FableList, fetchAllPages } from "./discovery/export-lists.js";
import type { LibbyClient } from "./libby-client.js";
import type { BookSnapshot, SnapshotField } from "./sync.js";
import type { SyncAdapter } from "./sync-plan.js";
import type { ShelfItem, SyncResponse } from "./types.js";

/** One Fable list entry: the book with the user's reading data, plus the entry's note. */
export interface FableEntry {
  book?: FableBook & {
    id?: string;
    reading_progress?: { current_percentage?: number | null; status?: string | null } | null;
    user_rating?: unknown;
  };
  note?: string | null;
}

const LIBBY_FIELDS = ["checkedOut"] as const;
const FABLE_FIELDS = ["readingProgress", "readingStatus", "rating", "notes", "shelves"] as const;
const PAGE = { limit: 50, offset: 0 };

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

/** Use this function to convert Libby's account state into snapshots: every current loan is a checked-out book. */
export function libbySnapshots(state: SyncResponse): BookSnapshot[] {
  const books = new Map<string, BookSnapshot>();
  for (const loan of state.loans ?? []) {
    if (!loan.title || books.has(loan.id)) continue;
    const author = typeof loan.firstCreatorName === "string" ? loan.firstCreatorName : undefined;
    const isbn = loanIsbn(loan);
    books.set(loan.id, {
      bookId: `libby:${loan.id}`,
      title: loan.title,
      ...(author ? { author } : {}),
      ...(isbn ? { isbn } : {}),
      providerId: loan.id,
      fields: { checkedOut: { value: true } },
    });
  }
  return [...books.values()];
}

/** Use this function to convert Fable list entries into snapshots; a book on several lists becomes one snapshot whose shelves name every list. */
export function fableSnapshots(lists: { list: FableList; entries: FableEntry[] }[]): BookSnapshot[] {
  const books = new Map<string, { snapshot: BookSnapshot; shelves: string[] }>();
  for (const { list, entries } of lists) {
    for (const { book, note } of entries) {
      const id = book?.id;
      const title = book?.title?.trim();
      if (!id || !title) continue;
      const known = books.get(id);
      if (known) {
        known.shelves.push(list.name);
        // ponytail: Fable notes belong to a list entry; the first non-empty note stands for the book.
        if (!known.snapshot.fields.notes && note) known.snapshot.fields.notes = { value: note };
        continue;
      }
      const progress = book.reading_progress;
      const status = progress?.status?.replaceAll("_", "-");
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
            readingStatus: field(status || undefined),
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

/** Use this function to stand in for an app with no login: its schema is empty, so it reads nothing and receives nothing. */
export function disconnectedAdapter(): SyncAdapter {
  return { verified: false, fields: [], writableFields: [], read: async () => [], write: unverifiedWrite };
}

/** Use this function to read the signed-in Libby account's loans as a read-only sync adapter. */
export function libbyAdapter(client: LibbyClient): SyncAdapter {
  return {
    verified: false,
    fields: LIBBY_FIELDS,
    writableFields: [],
    read: async () => libbySnapshots(await client.sync()),
    write: unverifiedWrite,
  };
}

/** Use this function to read every Fable list and its books as a read-only sync adapter. */
export function fableAdapter(get: FableGet): SyncAdapter {
  return {
    verified: false,
    fields: FABLE_FIELDS,
    writableFields: [],
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
    write: unverifiedWrite,
  };
}
