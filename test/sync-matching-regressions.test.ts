import { describe, expect, it } from "vitest";
import { type BookSnapshot, formatsCompatible, matchSnapshotGroups } from "../src/sync.js";
import { libbyAdapter } from "../src/sync-adapters.js";
import { resolveSyncSettings } from "../src/sync-config.js";
import {
  applySync,
  createMemoryJournal,
  type FableCatalogMatch,
  previewSync,
  type SyncAdapter,
} from "../src/sync-plan.js";

const context = { userId: "u", connectionId: "c" };
const settings = resolveSyncSettings();

function book(bookId: string, over: Partial<BookSnapshot> = {}): BookSnapshot {
  return { bookId, title: "Piranesi", author: "Susanna Clarke", fields: {}, ...over };
}
/** Pairs of [Libby IDs, Fable IDs] per group, for groups with both sides. */
function joined(libby: BookSnapshot[], fable: BookSnapshot[]) {
  return matchSnapshotGroups(libby, fable, "work")
    .groups.filter((group) => group.libby.length && group.fable.length)
    .map((group) => [group.libby.map((b) => b.bookId), group.fable.map((b) => b.bookId)]);
}
function adapter(books: () => BookSnapshot[], over: Partial<SyncAdapter> = {}): SyncAdapter {
  return {
    verified: true,
    fields: ["readingStatus", "checkedOut", "readingProgress", "note"],
    writableFields: [],
    read: async () => structuredClone(books()),
    write: async () => {},
    ...over,
  };
}
/** Track the most calls in flight at once. */
function concurrency() {
  let now = 0;
  let max = 0;
  return {
    get max() {
      return max;
    },
    async run<T>(value: T): Promise<T> {
      max = Math.max(max, ++now);
      await new Promise((resolve) => setTimeout(resolve, 1));
      now -= 1;
      return value;
    },
  };
}
const loan = (id: string, title = `Book ${id}`) =>
  book(`libby:${id}`, {
    title,
    author: "Author",
    fields: { checkedOut: { value: true }, readingProgress: { value: 40 } },
  });

describe("format-aware matching", () => {
  it("treats an unknown format as compatible with any format", () => {
    expect(formatsCompatible(undefined, "ebook")).toBe(true);
    expect(formatsCompatible("ebook", "ebook")).toBe(true);
    expect(formatsCompatible("ebook", "audiobook")).toBe(false);
  });

  it("matches by title and author when only Libby knows the format", () => {
    expect(joined([book("l", { format: "ebook" })], [book("f")])).toEqual([[["l"], ["f"]]]);
  });

  it("matches by work ID when only one side knows the format", () => {
    expect(joined([book("l", { format: "ebook", workId: "w" })], [book("f", { workId: "w" })])).toEqual([
      [["l"], ["f"]],
    ]);
  });

  it("never joins two known, different formats", () => {
    expect(joined([book("l", { format: "ebook" })], [book("f", { format: "audiobook" })])).toEqual([]);
    expect(
      joined([book("l", { format: "ebook", workId: "w" })], [book("f", { format: "audiobook", workId: "w" })]),
    ).toEqual([]);
  });

  it("picks the one compatible edition when Fable has several formats", () => {
    const fable = [book("f-audio", { format: "audiobook" }), book("f-ebook", { format: "ebook" })];
    expect(joined([book("l", { format: "ebook" })], fable)).toEqual([[["l"], ["f-ebook"]]]);
  });

  it("joins each format's editions separately under one work ID", () => {
    const libby = [
      book("l-audio", { format: "audiobook", workId: "w" }),
      book("l-ebook", { format: "ebook", workId: "w" }),
    ];
    const fable = [
      book("f-audio", { format: "audiobook", workId: "w" }),
      book("f-ebook", { format: "ebook", workId: "w" }),
    ];
    expect(joined(libby, fable).sort()).toEqual([
      [["l-audio"], ["f-audio"]],
      [["l-ebook"], ["f-ebook"]],
    ]);
  });

  it("still reports two equally good candidates as ambiguous", () => {
    const result = matchSnapshotGroups([book("l", { format: "ebook" })], [book("f1"), book("f2")], "work");
    expect(result.conflicts).toMatchObject([
      { code: "ambiguous-match", libbyBookIds: ["l"], fableBookIds: ["f1", "f2"] },
    ]);
  });
});

describe("catalog search failures", () => {
  it("keeps the preview when a Fable search fails for a saved selection", async () => {
    const plan = await previewSync({
      context,
      settings,
      adapters: {
        libby: adapter(() => [loan("1", "Piranesi")]),
        fable: adapter(() => [], {
          createFields: ["readingStatus"],
          searchCatalog: async () => {
            throw new Error("Fable search is down");
          },
        }),
      },
      options: { catalogSelections: { "libby:1": "cat-7" } },
    });
    expect(plan.operations).toEqual([]);
    expect(plan.conflicts).toMatchObject([
      { message: expect.stringMatching(/^Could not search Fable for Piranesi/), libbyBookIds: ["libby:1"] },
    ]);
  });

  it("still refuses a selection the search no longer offers", async () => {
    const input = {
      context,
      settings,
      adapters: {
        libby: adapter(() => [loan("1")]),
        fable: adapter(() => [], { createFields: ["readingStatus"], searchCatalog: async () => [] }),
      },
      options: { catalogSelections: { "libby:1": "gone" } },
    };
    await expect(previewSync(input)).rejects.toThrow(/no longer available/);
  });
});

describe("shared catalog editions", () => {
  it("adds an edition once and lists the second loan that matched it", async () => {
    const match: FableCatalogMatch = { id: "cat", title: "Same", automatic: true };
    const plan = await previewSync({
      context,
      settings,
      adapters: {
        libby: adapter(() => [loan("1", "Same"), loan("2", "Same, again")]),
        fable: adapter(() => [], { createFields: ["readingStatus"], searchCatalog: async () => [match] }),
      },
    });
    expect(plan.operations.filter((operation) => operation.create)).toHaveLength(1);
    const reported = plan.conflicts.filter((conflict) => /already proposed for another loan/.test(conflict.message));
    expect(reported).toHaveLength(1);
    expect(plan.operations[0]!.bookId).not.toBe(reported[0]!.libbyBookIds[0]);
  });
});

describe("apply staleness check", () => {
  it("ignores a catalog-filled ISBN that one Libby read had and the next lacked", async () => {
    let isbn: string | undefined = "9780593135204";
    const note = (value: string, updatedAt: string) => ({ value, updatedAt });
    const fableBooks = [book("fable-1", { workId: "w", fields: { note: note("old", "2026-01-01T00:00:00Z") } })];
    const adapters = {
      libby: adapter(() => [
        book("libby-1", {
          workId: "w",
          ...(isbn ? { isbn } : {}),
          fields: { note: note("new", "2026-01-02T00:00:00Z") },
        }),
      ]),
      fable: adapter(() => fableBooks, {
        writableFields: ["note"],
        write: async (_context, operation) => {
          fableBooks[0]!.fields.note = { value: operation.after as string, updatedAt: "2026-01-03T00:00:00Z" };
        },
      }),
    };
    const plan = await previewSync({ context, settings, adapters });
    expect(plan.operations).toHaveLength(1);
    isbn = undefined;
    const report = await applySync({
      context,
      settings,
      plan,
      adapters,
      journal: createMemoryJournal(),
      approvals: { selected: [plan.operations[0]!.id], removals: [] },
    });
    expect(report.outcomes).toMatchObject([{ status: "success" }]);
  });
});

describe("lookup concurrency", () => {
  it("caps Fable catalog searches during a preview", async () => {
    const searches = concurrency();
    await previewSync({
      context,
      settings,
      adapters: {
        libby: adapter(() => Array.from({ length: 10 }, (_, index) => loan(String(index)))),
        fable: adapter(() => [], { searchCatalog: () => searches.run([]) }),
      },
    });
    expect(searches.max).toBe(4);
  });

  it("caps Libby progress reads and catalog lookups per read", async () => {
    const progress = concurrency();
    const catalog = concurrency();
    const loans = Array.from({ length: 10 }, (_, index) => ({ id: String(index), cardId: "c", title: `T${index}` }));
    const libby = libbyAdapter(
      {
        sync: async () => ({ cards: [{ cardId: "c", advantageKey: "lib" }], loans }),
        loanProgress: () => progress.run(50),
      } as never,
      undefined,
      { getLibraryMedia: (_library: string, id: string) => catalog.run({ id, title: "T" }) } as never,
    );
    const books = await libby.read(context);
    expect(books).toHaveLength(10);
    expect(progress.max).toBe(4);
    expect(catalog.max).toBe(4);
  });
});
