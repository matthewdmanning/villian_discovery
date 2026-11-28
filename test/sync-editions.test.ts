import { describe, expect, it, vi } from "vitest";
import type { BookMetadataSource, Edition } from "../src/book-metadata.js";
import type { BookSnapshot } from "../src/sync.js";
import { resolveSyncSettings } from "../src/sync-config.js";
import { EDITION_WORK_PREFIX, linkEditions } from "../src/sync-editions.js";
import { applySync, createMemoryJournal, previewSync, type SyncAdapter } from "../src/sync-plan.js";

const EBOOK = "9781635575644";
const PRINT = "9781635575637";
const AUDIO = "9781526622419";
const context = { userId: "u", connectionId: "c" };

const loan = (over: Partial<BookSnapshot> = {}): BookSnapshot => ({
  bookId: "libby:1",
  title: "Piranesi",
  isbn: EBOOK,
  format: "ebook",
  fields: { checkedOut: { value: true }, readingProgress: { value: 40 } },
  ...over,
});
// Fable's title differs, so only the edition check can match it.
const fableBook = (over: Partial<BookSnapshot> = {}): BookSnapshot => ({
  bookId: "fable:9",
  title: "Piranesi: A Novel",
  author: "S. Clarke",
  isbn: PRINT,
  fields: { readingProgress: { value: 10 } },
  ...over,
});
const metadataOf = (editions: Edition[] | Error): BookMetadataSource => ({
  id: "combined",
  byIsbn: vi.fn(async () => null),
  editions: vi.fn(async () => {
    if (editions instanceof Error) throw editions;
    return editions;
  }),
});
const work = [{ isbn: EBOOK, format: "ebook" as const }, { isbn: PRINT, format: "print" as const }, { isbn: AUDIO }];

describe("linkEditions", () => {
  it("links a loan to the one Fable book that is another edition of its work", async () => {
    const metadata = metadataOf(work);
    const { libby, fable } = await linkEditions({ libby: [loan()], fable: [fableBook()] }, metadata);
    expect(libby[0]!.workId).toBe(`${EDITION_WORK_PREFIX}${EBOOK}`);
    expect(fable[0]!.workId).toBe(libby[0]!.workId);
    expect(metadata.editions).toHaveBeenCalledExactlyOnceWith(EBOOK);
  });

  it("asks nothing when an ISBN already matches, or when no book can be checked", async () => {
    const metadata = metadataOf(work);
    await linkEditions({ libby: [loan({ isbn: PRINT })], fable: [fableBook()] }, metadata);
    await linkEditions({ libby: [loan({ isbn: undefined })], fable: [fableBook()] }, metadata);
    await linkEditions({ libby: [loan()], fable: [fableBook({ isbn: undefined })] }, metadata);
    await linkEditions({ libby: [loan({ workId: "provider" })], fable: [fableBook()] }, metadata);
    expect(metadata.editions).not.toHaveBeenCalled();
  });

  it("leaves ambiguous, incompatible and failed checks unlinked", async () => {
    const twoCopies = { libby: [loan()], fable: [fableBook(), fableBook({ bookId: "fable:10", isbn: AUDIO })] };
    await linkEditions(twoCopies, metadataOf(work));
    expect(twoCopies.fable.map((book) => book.workId)).toEqual([undefined, undefined]);

    const audiobook = { libby: [loan()], fable: [fableBook({ format: "audiobook" })] };
    await linkEditions(audiobook, metadataOf(work));
    expect(audiobook.libby[0]!.workId).toBeUndefined();

    const claimedTwice = {
      libby: [loan(), loan({ bookId: "libby:2", isbn: AUDIO, format: undefined })],
      fable: [fableBook()],
    };
    await linkEditions(claimedTwice, metadataOf(work));
    expect(claimedTwice.fable[0]!.workId).toBeUndefined();

    const failed = { libby: [loan()], fable: [fableBook()] };
    await linkEditions(failed, metadataOf(new Error("Open Library could not be reached.")));
    expect(failed.libby[0]!.workId).toBeUndefined();
  });
});

describe("sync with edition checks", () => {
  const adapter = (books: () => BookSnapshot[], over: Partial<SyncAdapter> = {}): SyncAdapter => ({
    verified: true,
    fields: ["checkedOut", "readingProgress"],
    writableFields: [],
    read: async () => structuredClone(books()),
    write: async () => {},
    ...over,
  });

  it("matches a loan to its Fable edition in a preview, and not without metadata", async () => {
    const adapters = { libby: adapter(() => [loan()]), fable: adapter(() => [fableBook()]) };
    const settings = resolveSyncSettings();
    const linked = await previewSync({ context, settings, adapters, metadata: metadataOf(work) });
    expect(linked.groups.filter((group) => group.libby.length && group.fable.length)).toHaveLength(1);
    const unlinked = await previewSync({ context, settings, adapters });
    expect(unlinked.groups.filter((group) => group.libby.length && group.fable.length)).toHaveLength(0);
  });

  it("does not read a failed edition check on apply as a change in the library", async () => {
    const fableBooks = [fableBook()];
    const adapters = {
      libby: adapter(() => [loan()]),
      fable: adapter(() => fableBooks, {
        writableFields: ["readingProgress"],
        write: async (_context, operation, assertCurrent) => {
          await assertCurrent();
          fableBooks[0]!.fields.readingProgress = { value: operation.after as number };
        },
      }),
    };
    const settings = resolveSyncSettings();
    const metadata = metadataOf(work);
    const plan = await previewSync({ context, settings, adapters, metadata });
    const progress = plan.operations.find((operation) => operation.field === "readingProgress");
    expect(progress).toMatchObject({ after: 40 });
    // Later reads cannot reach Open Library, so the link is missing from them.
    vi.mocked(metadata.editions).mockRejectedValue(new Error("Open Library could not be reached."));
    const report = await applySync({
      context,
      settings,
      plan,
      adapters,
      metadata,
      journal: createMemoryJournal(),
      approvals: { selected: [progress!.id], removals: [] },
    });
    expect(report.outcomes).toMatchObject([{ operationId: progress!.id, status: "success" }]);
    expect(fableBooks[0]!.fields.readingProgress).toEqual({ value: 40 });
  });
});
