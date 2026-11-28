import { describe, expect, it, vi } from "vitest";
import { isBorrowedTag, readPastCheckouts } from "../src/libby-lists.js";
import { type BookSnapshot, BookSnapshotSchema } from "../src/sync.js";
import { fableSnapshots, libbySnapshots } from "../src/sync-adapters.js";
import { resolveSyncSettings } from "../src/sync-config.js";
import { applySync, createMemoryJournal, previewSync, type SyncAdapter } from "../src/sync-plan.js";

describe("loan end dates", () => {
  it("keeps a loan's end date, the latest across cards, and drops one that does not parse", () => {
    const books = libbySnapshots({
      loans: [
        { id: "11", cardId: "1", title: "Dune", expireDate: "2026-12-01T05:00:00Z" },
        { id: "11", cardId: "2", title: "Dune", expireDate: "2026-12-09T05:00:00.000+00:00" },
        { id: "12", cardId: "1", title: "Emma", expireDate: "soon" },
        { id: "13", cardId: "1", title: "Kindred" },
      ],
    });
    expect(books.map((book) => book.expiresAt)).toEqual(["2026-12-09T05:00:00.000Z", undefined, undefined]);
    for (const book of books) BookSnapshotSchema.parse(book);
  });
});

describe("Fable page links", () => {
  const list = { id: "l", name: "Currently Reading", system_type: "current_reading" };
  it("keeps a fable.co book page and drops any other link", () => {
    const books = fableSnapshots([
      {
        list,
        entries: [
          { book: { id: "a", title: "Piranesi", url: "https://fable.co/book/piranesi-by-susanna-clarke-163557563X" } },
          { book: { id: "b", title: "Dune", url: "https://evil.example/book/dune" } },
          { book: { id: "c", title: "Emma", url: "javascript:alert(1)" } },
          { book: { id: "d", title: "Kindred", url: 42 } },
        ],
      },
    ]);
    expect(books.map((book) => book.pageUrl)).toEqual([
      "https://fable.co/book/piranesi-by-susanna-clarke-163557563X",
      undefined,
      undefined,
      undefined,
    ]);
    for (const book of books) BookSnapshotSchema.parse(book);
  });

  it("refuses a snapshot page link outside fable.co", () => {
    const book = { bookId: "fable:1", title: "Dune", fields: {} };
    expect(() => BookSnapshotSchema.parse({ ...book, pageUrl: "https://fable.co.evil.example/book" })).toThrow();
    expect(() => BookSnapshotSchema.parse({ ...book, pageUrl: "http://fable.co/book" })).toThrow();
  });
});

describe("display data between preview and apply", () => {
  it("applies when only a loan's end date or a Fable page link changed", async () => {
    const context = { userId: "u", connectionId: "c" };
    let renewed = false;
    const fableBooks: BookSnapshot[] = [
      { bookId: "fable:1", title: "Dune", author: "Frank Herbert", fields: { readingProgress: { value: 10 } } },
    ];
    const adapter = (books: () => BookSnapshot[], over: Partial<SyncAdapter> = {}): SyncAdapter => ({
      verified: true,
      fields: ["checkedOut", "readingProgress"],
      writableFields: [],
      read: async () => structuredClone(books()),
      write: async () => {},
      ...over,
    });
    const adapters = {
      libby: adapter(() => [
        {
          bookId: "libby:1",
          title: "Dune",
          author: "Frank Herbert",
          expiresAt: renewed ? "2026-12-20T00:00:00.000Z" : "2026-12-01T00:00:00.000Z",
          fields: { checkedOut: { value: true }, readingProgress: { value: 40 } },
        },
      ]),
      fable: adapter(
        () => fableBooks.map((book) => (renewed ? { ...book, pageUrl: "https://fable.co/book/dune" } : book)),
        {
          writableFields: ["readingProgress"],
          write: async (_context, operation, assertCurrent) => {
            await assertCurrent();
            fableBooks[0]!.fields.readingProgress = { value: operation.after as number };
          },
        },
      ),
    };
    const settings = resolveSyncSettings();
    const plan = await previewSync({ context, settings, adapters });
    const progress = plan.operations.find((operation) => operation.field === "readingProgress");
    renewed = true;
    const report = await applySync({
      context,
      settings,
      plan,
      adapters,
      journal: createMemoryJournal(),
      approvals: { selected: [progress!.id], removals: [] },
    });
    expect(report.outcomes).toMatchObject([{ operationId: progress!.id, status: "success" }]);
  });
});

describe("past checkouts", () => {
  const borrowed = { uuid: "b", name: "🏷️ Borrowed" };
  const client = (tags: { uuid: string; name: string }[]) => ({
    tags: vi.fn(async () => ({ tags })),
    taggings: vi.fn(async () => ({
      tag: { taggings: [{ titleId: 7, sortTitle: "Piranesi", sortAuthor: "Clarke, Susanna" }] },
    })),
  });

  it("recognizes Libby's Borrowed tag with any case or emoji, and nothing longer", () => {
    expect(
      ["Borrowed", " borrowed ", "🏷️ Borrowed", "BORROWED!"].every((name) => isBorrowedTag({ name, uuid: "x" })),
    ).toBe(true);
    expect(["Borrowed twice", "Not borrowed", "Borrow"].some((name) => isBorrowedTag({ name, uuid: "x" }))).toBe(false);
  });

  it("reads only the Borrowed tag's titles", async () => {
    const libby = client([{ uuid: "f", name: "Favorites" }, borrowed]);
    await expect(readPastCheckouts(libby)).resolves.toEqual({
      status: "available",
      source: "borrowed-tag",
      items: [{ id: "7", title: "Piranesi", author: "Clarke, Susanna", tags: ["b"] }],
    });
    expect(libby.taggings).toHaveBeenCalledExactlyOnceWith(borrowed);
  });

  it("says how to turn the tag on when Libby has none", async () => {
    const libby = client([{ uuid: "f", name: "Favorites" }]);
    await expect(readPastCheckouts(libby)).resolves.toMatchObject({ status: "unavailable" });
    expect(libby.taggings).not.toHaveBeenCalled();
  });
});
