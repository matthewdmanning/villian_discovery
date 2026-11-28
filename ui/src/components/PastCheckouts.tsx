import type { ListItem, PastCheckouts as PastCheckoutsData } from "../../../src/libby-lists.ts";
import { normalizeName, normalizeTitle } from "../../../src/matcher.ts";
import type { BookSnapshot } from "../../../src/sync.ts";
import { toStatusKey } from "../lib/sync-books.ts";
import { ReadingStatus } from "./SyncBook.tsx";
import { RefreshButton } from "./ui.tsx";

/** Use this function to find the Fable book for a past checkout by title and, when both have one, author. */
export function fableBookFor(
  item: Pick<ListItem, "title" | "author">,
  fable: BookSnapshot[],
): BookSnapshot | undefined {
  const title = normalizeTitle(item.title, true);
  const author = item.author && normalizeName(item.author);
  return fable.find(
    (book) =>
      title &&
      normalizeTitle(book.title, true) === title &&
      (!author || !book.author || normalizeName(book.author) === author),
  );
}

/** Use this component below the checkouts: past Libby loans with their Fable state, at most three rows tall before it scrolls. */
export function PastCheckouts({
  data,
  error,
  loading,
  reload,
  checkedOut,
  fable,
}: {
  data: PastCheckoutsData | undefined;
  error: string | undefined;
  loading: boolean;
  reload(): void;
  /** Libby title IDs on the Shelf now; they are not past checkouts. */
  checkedOut: ReadonlySet<string>;
  fable: BookSnapshot[];
}) {
  const items = data?.status === "available" ? data.items.filter((item) => !checkedOut.has(item.id)) : [];
  return (
    <section aria-label="Past checkouts">
      <h2 className="font-display text-xl font-bold">Past checkouts</h2>
      <p className="text-sm opacity-70">From Libby's Borrowed tag</p>
      {loading ? (
        <p role="status" className="text-sm">
          Loading past checkouts…
        </p>
      ) : error ? (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-sm">
          Could not load past checkouts: {error}
          <RefreshButton className="btn btn-xs" onClick={reload}>
            Retry
          </RefreshButton>
        </p>
      ) : data?.status === "unavailable" ? (
        <p className="text-sm">{data.reason}</p>
      ) : !items.length ? (
        <p className="text-sm">No past checkouts</p>
      ) : (
        <ul
          className="max-h-[10.5rem] divide-y divide-base-300 overflow-y-auto overscroll-contain"
          aria-label="Past checkouts list"
        >
          {items.map((item) => {
            const book = fableBookFor(item, fable);
            const status = toStatusKey(book?.fields.readingStatus?.value);
            return (
              <li key={item.id} className="flex h-14 items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate font-display font-semibold italic">{item.title}</span>
                  {item.author && <span className="block truncate text-xs opacity-75">{item.author}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-sm">
                  {!book ? (
                    <span className="opacity-70">Not in Fable</span>
                  ) : status ? (
                    <ReadingStatus status={status} />
                  ) : (
                    <span className="opacity-70">In Fable</span>
                  )}
                  {book?.pageUrl && (
                    <a className="link" href={book.pageUrl} target="_blank" rel="noreferrer">
                      Open in Fable<span className="sr-only">: {item.title}</span>
                    </a>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
