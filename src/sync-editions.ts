import type { BookMetadataSource } from "./book-metadata.js";
import { LOOKUP_CONCURRENCY, mapLimit } from "./map-limit.js";
import { isbn13 } from "./matcher.js";
import { type BookSnapshot, formatsCompatible } from "./sync.js";

/** Work IDs set by `linkEditions` start with this, so checks can tell them from provider data. */
export const EDITION_WORK_PREFIX = "editions:";

/**
 * Check Libby loans against Fable books through public edition data. When a loan's ISBN differs from every
 * Fable ISBN, look up the editions of the loan's work. If exactly one format-compatible Fable book carries one
 * of those edition ISBNs, it is the same book in another edition: both get one shared `workId`, so sync matches
 * them by verified identity rather than by title. Ambiguous or failed lookups change nothing.
 * Mutates and returns `snapshots`. Sends only the loans' ISBNs to the metadata services.
 */
export async function linkEditions(
  snapshots: { libby: BookSnapshot[]; fable: BookSnapshot[] },
  metadata: BookMetadataSource,
): Promise<{ libby: BookSnapshot[]; fable: BookSnapshot[] }> {
  const fableByIsbn = new Map<string, BookSnapshot[]>();
  for (const book of snapshots.fable) {
    const isbn = book.isbn && isbn13(book.isbn);
    if (isbn) fableByIsbn.set(isbn, [...(fableByIsbn.get(isbn) ?? []), book]);
  }
  if (!fableByIsbn.size) return snapshots;
  const loans = snapshots.libby.flatMap((book) => {
    const isbn = book.isbn && isbn13(book.isbn);
    // A shared ISBN already matches; a work ID from a provider is never overwritten.
    return isbn && !book.workId && !fableByIsbn.has(isbn) ? [{ book, isbn }] : [];
  });
  const found = await mapLimit(loans, LOOKUP_CONCURRENCY, async ({ book, isbn }) => {
    const editions = await metadata.editions(isbn).catch(() => []);
    const candidates = new Set(
      editions
        .flatMap((edition) => fableByIsbn.get(edition.isbn) ?? [])
        .filter((fable) => !fable.workId && formatsCompatible(book.format, fable.format)),
    );
    return { book, isbn, candidates: [...candidates] };
  });
  // A Fable book claimed by two loans is ambiguous for both.
  const claims = new Map<BookSnapshot, number>();
  for (const { candidates } of found)
    if (candidates.length === 1) claims.set(candidates[0]!, (claims.get(candidates[0]!) ?? 0) + 1);
  for (const { book, isbn, candidates } of found) {
    const [fable] = candidates;
    if (candidates.length !== 1 || claims.get(fable!) !== 1) continue;
    const workId = `${EDITION_WORK_PREFIX}${isbn}`;
    book.workId = workId;
    fable!.workId = workId;
  }
  return snapshots;
}
